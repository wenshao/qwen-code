/**
 * PR #13013 maintainer verification — REAL model leg (not part of the PR).
 *
 * One headless single-tool run through the arm's own TestRig, against the real
 * endpoint via a local recording reverse proxy, so every request the CLI makes
 * is counted and classified (main vs managed-auto-memory extractor).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestRig } from '../test-helper.js';

const ARM = process.env['AB_ARM'] ?? 'unknown';
const REP = Number(process.env['AB_REP'] ?? '0');
const OUT = process.env['AB_OUT'] ?? '/dev/null';
const UPSTREAM = new URL(process.env['AB_UPSTREAM']!); // https://host/compatible-mode/v1
const MODEL = process.env['AB_MODEL']!;
const EXTRACTOR_MARK = 'managed memory extraction subagent';

type Entry = { klass: string; stream: boolean; start: number; end: number; status: number };

async function startProxy() {
  const log: Entry[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(body.toString('utf-8'));
      } catch {}
      const klass = JSON.stringify(parsed['messages'] ?? []).includes(EXTRACTOR_MARK)
        ? 'extractor'
        : parsed['stream'] === true
          ? 'main'
          : 'side';
      const entry: Entry = { klass, stream: parsed['stream'] === true, start: Date.now(), end: 0, status: 0 };
      log.push(entry);
      const path = UPSTREAM.pathname.replace(/\/$/, '') + (req.url ?? '').replace(/^\/v1/, '');
      const headers = { ...req.headers, host: UPSTREAM.host, 'content-length': String(body.length) };
      const up = httpsRequest(
        { host: UPSTREAM.hostname, port: 443, method: req.method, path, headers },
        (upRes) => {
          entry.status = upRes.statusCode ?? 0;
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.pipe(res);
          upRes.on('end', () => (entry.end = Date.now()));
        },
      );
      up.on('error', (e) => {
        entry.status = -1;
        entry.end = Date.now();
        res.writeHead(502);
        res.end(String(e));
      });
      up.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { log, baseUrl: `http://127.0.0.1:${port}/v1`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe(`PR13013 real-model arm=${ARM} rep=${REP}`, () => {
  afterEach(() => vi.unstubAllEnvs());

  it('single read_file turn', async () => {
    vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
    vi.stubEnv('no_proxy', '127.0.0.1,localhost');
    vi.stubEnv('OPENAI_API_KEY', process.env['AB_KEY']!);
    const proxy = await startProxy();
    const rig = new TestRig();
    await rig.setup(`real13013-${ARM}-${REP}`);
    rig.createFile('probe.txt', 'BANANA-13013\n');
    const settings = JSON.parse(readFileSync(join(rig.testDir!, '.qwen', 'settings.json'), 'utf-8'));
    const t0 = Date.now();
    let out = '';
    try {
      out = await rig.run(
        'Use the read_file tool to read probe.txt, then reply with exactly the single word it contains.',
        '--output-format', 'json',
        '--auth-type', 'openai',
        '--model', MODEL,
        '--openai-base-url', proxy.baseUrl,
      );
    } finally {
      await proxy.close();
    }
    const wallMs = Date.now() - t0;
    const parsed = JSON.parse(out) as Array<Record<string, any>>;
    const result = parsed.find((m) => m['type'] === 'result') as Record<string, any>;
    const bySource = Object.fromEntries(
      Object.entries(result?.stats?.models?.[MODEL]?.bySource ?? {}).map(([k, v]: [string, any]) => [
        k,
        { requests: v?.api?.totalRequests, latencyMs: v?.api?.totalLatencyMs, prompt: v?.tokens?.prompt },
      ]),
    );
    const lastMain = [...proxy.log].reverse().find((e) => e.klass === 'main');
    const lastEnd = Math.max(...proxy.log.map((e) => e.end));
    const row = {
      arm: ARM,
      rep: REP,
      wallMs,
      requests: proxy.log.map((e) => ({ klass: e.klass, status: e.status, ms: e.end - e.start })),
      extractorMs: proxy.log.filter((e) => e.klass === 'extractor').reduce((s, e) => s + (e.end - e.start), 0),
      tailAfterLastMainMs: lastMain ? lastEnd - lastMain.end : 0,
      bySource,
      subtype: result?.subtype,
      resultText: String(result?.result ?? '').slice(0, 80),
      settingsMemory: settings.memory ?? null,
    };
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    expect(result?.subtype).toBe('success');
    expect(String(result?.result)).toContain('BANANA');
    await rig.cleanup();
  }, 240_000);
});
