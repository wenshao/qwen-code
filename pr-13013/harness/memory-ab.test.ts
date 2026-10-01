/**
 * PR #13013 maintainer verification harness (not part of the PR).
 *
 * Drops into integration-tests/__verify13013__/ of EITHER arm unchanged, so
 * each arm exercises its own TestRig / SDKTestHelper against the same built
 * dist/cli.js and a scripted fake OpenAI endpoint. Every request the CLI makes
 * is classified (main / extractor / side) and appended to AB_OUT as JSONL.
 */
import { appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { query } from '@qwen-code/sdk';
import { TestRig } from '../test-helper.js';
import { SDKTestHelper, createSharedTestOptions } from '../sdk-typescript/test-helper.js';
import {
  startFakeOpenAIServer,
  fakeToolCall,
  type FakeOpenAIServer,
} from '../fake-openai-server.js';

const ARM = process.env['AB_ARM'] ?? 'unknown';
const LATENCY = Number(process.env['AB_LATENCY_MS'] ?? '0');
const REPS = Number(process.env['AB_REPS'] ?? '3');
const OUT = process.env['AB_OUT'] ?? '/dev/null';
const EXTRACTOR_MARK = 'managed memory extraction subagent';

type Klass = 'main' | 'extractor' | 'side';
function classify(body: Record<string, unknown>): Klass {
  const msgs = JSON.stringify(body['messages'] ?? []);
  if (msgs.includes(EXTRACTOR_MARK)) return 'extractor';
  if (body['stream'] !== true) return 'side';
  return 'main';
}
function hasToolResult(body: Record<string, unknown>): boolean {
  const msgs = body['messages'];
  return Array.isArray(msgs) && msgs.some((m) => m?.role === 'tool');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startServer(targetFile: string | null): Promise<{
  server: FakeOpenAIServer;
  log: Array<{ klass: Klass; t: number }>;
}> {
  const log: Array<{ klass: Klass; t: number; tools?: string[]; sysLen?: number; sys?: string }> = [];
  const server = await startFakeOpenAIServer(async ({ body }) => {
    const klass = classify(body);
    const tools = Array.isArray(body['tools'])
      ? (body['tools'] as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '?')
      : [];
    const msgs = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>;
    const sys = msgs.filter((m) => m.role === 'system').map((m) => JSON.stringify(m.content)).join('\n');
    log.push({ klass, t: Date.now(), tools, sysLen: sys.length, sys });
    if (LATENCY) await sleep(LATENCY);
    if (klass === 'side') return { content: '{"selected_memories":[]}' };
    if (klass === 'extractor') return { content: 'Nothing worth saving.' };
    if (targetFile && !hasToolResult(body)) {
      return {
        toolCalls: [fakeToolCall('read_file', { file_path: targetFile })],
      };
    }
    return { content: 'DONE_13013' };
  });
  return { server, log };
}

function record(row: Record<string, unknown>) {
  appendFileSync(OUT, JSON.stringify({ arm: ARM, latencyMs: LATENCY, ...row }) + '\n');
}
function tally(log: Array<{ klass: Klass }>) {
  const c = { main: 0, extractor: 0, side: 0 };
  for (const e of log) c[e.klass]++;
  return c;
}
function memoryDirs(home: string | undefined): string[] {
  if (!home || !existsSync(home)) return [];
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/memor/i.test(p)) out.push(p.slice(home.length));
    }
  };
  walk(home, 0);
  return out;
}

describe(`PR13013 A/B arm=${ARM} latency=${LATENCY}ms`, () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const scenario of ['cli-tool', 'cli-text'] as const) {
    for (let rep = 0; rep < REPS; rep++) {
      it(`${scenario} #${rep}`, async () => {
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');
        const rig = new TestRig();
        await rig.setup(`ab13013-${scenario}-${rep}`);
        const target =
          scenario === 'cli-tool' ? rig.createFile('probe.txt', 'hello 13013\n') : null;
        const { server, log } = await startServer(target);
        const settings = JSON.parse(
          readFileSync(join(rig.testDir!, '.qwen', 'settings.json'), 'utf-8'),
        );
        const t0 = Date.now();
        let out = '';
        try {
          out = await rig.run(
            scenario === 'cli-tool' ? 'Read probe.txt and say done.' : 'Say done.',
            '--output-format',
            'json',
            '--auth-type',
            'openai',
            '--model',
            'fake-model',
            '--openai-base-url',
            server.baseUrl,
            '--openai-api-key',
            'fake-key',
          );
        } finally {
          await server.close();
        }
        const tEnd = Date.now();
        const wallMs = tEnd - t0;
        const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
        const result = parsed.find((m) => m['type'] === 'result') as Record<string, any>;
        const bySource = Object.fromEntries(
          Object.entries(result?.stats?.models?.['fake-model']?.bySource ?? {}).map(
            ([k, v]: [string, any]) => [k, v?.api?.totalRequests],
          ),
        );
        const lastMain = [...log].reverse().find((e) => e.klass === 'main');
        const lastAny = log[log.length - 1];
        record({
          scenario,
          rep,
          wallMs,
          requests: tally(log),
          order: log.map((e) => e.klass),
          bySource,
          resultSubtype: result?.subtype,
          resultText: result?.result,
          settingsMemory: settings.memory ?? null,
          tailAfterLastMainMs: lastMain && lastAny ? lastAny.t - lastMain.t : 0,
          firstMainTools: log.find((e) => e.klass === 'main')?.tools,
          firstMainSysLen: log.find((e) => e.klass === 'main')?.sysLen,
          firstMainSys: process.env['AB_DUMP_SYS'] ? log.find((e) => e.klass === 'main')?.sys : undefined,
          startupToFirstReqMs: log.length ? log[0].t - t0 : null,
          lastReqToExitMs: lastAny ? tEnd - lastAny.t - LATENCY : null,
          memoryFiles: memoryDirs(process.env['QWEN_HOME']).length,
        });
        expect(result?.subtype).toBe('success');
        expect(result?.result).toContain('DONE_13013');
        await rig.cleanup();
      });
    }
  }

  for (let rep = 0; rep < REPS; rep++) {
    it(`sdk-tool #${rep}`, async () => {
      const helper = new SDKTestHelper();
      const dir = await helper.setup(`ab13013-sdk-${rep}`);
      const target = await helper.createFile('probe.txt', 'hello 13013\n');
      const { server, log } = await startServer(target);
      const settings = JSON.parse(
        readFileSync(join(dir, '.qwen', 'settings.json'), 'utf-8'),
      );
      const t0 = Date.now();
      let resultMsg: any;
      try {
        const q = query({
          prompt: 'Read probe.txt and say done.',
          options: {
            ...createSharedTestOptions(),
            cwd: dir,
            permissionMode: 'yolo',
            model: 'fake-model',
            authType: 'openai',
            env: {
              NO_PROXY: '127.0.0.1,localhost',
              no_proxy: '127.0.0.1,localhost',
              OPENAI_API_KEY: 'fake-key',
              OPENAI_BASE_URL: server.baseUrl,
              OPENAI_MODEL: 'fake-model',
              QWEN_MODEL: 'fake-model',
            },
          },
        });
        for await (const m of q) {
          if ((m as any).type === 'result') resultMsg = m;
        }
        await q.close();
      } finally {
        await server.close();
      }
      const wallMs = Date.now() - t0;
      record({
        scenario: 'sdk-tool',
        rep,
        wallMs,
        requests: tally(log),
        order: log.map((e) => e.klass),
        resultSubtype: resultMsg?.subtype,
        settingsMemory: settings.memory ?? null,
      });
      expect(resultMsg?.subtype).toBe('success');
      await helper.cleanup();
    });
  }
});
