#!/usr/bin/env npx tsx
/**
 * PR #10280, ACP surface probe.
 *
 * Speaks raw ACP JSON-RPC over stdio to the *bundled* CLI (`dist/cli.js --acp`),
 * lets the model issue a long-running shell tool call, sends a real
 * `session/cancel` while it is executing, then sends one more prompt and records
 * what the CLI puts on the wire to the model for that cancelled tool call.
 *
 * Env: PROBE_DIST, PROBE_ARM, PROBE_OUT
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fakeToolCall, startFakeOpenAIServer } from './fake-openai-server.js';

const DIST = resolve(process.env['PROBE_DIST'] ?? '');
const ARM = process.env['PROBE_ARM'] ?? 'UNKNOWN';
const OUT = resolve(process.env['PROBE_OUT'] ?? '/tmp/pr10280-acp');
const SLEEP_SECONDS = Number(process.env['PROBE_SLEEP'] ?? '45');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, 'cli.js'))) {
    throw new Error(`PROBE_DIST has no cli.js: ${DIST}`);
  }
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const homeDir = join(OUT, 'home');
  const workDir = join(OUT, 'work');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  const server = await startFakeOpenAIServer(({ requestIndex }) => {
    if (requestIndex === 0) {
      return {
        toolCalls: [
          fakeToolCall(
            'run_shell_command',
            {
              command: `echo PROBE_SHELL_STARTED && sleep ${SLEEP_SECONDS}`,
              description: 'long running probe command',
            },
            'probe_call_a',
          ),
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    }
    return {
      content: `PROBE_TURN_DONE_${requestIndex + 1}`,
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    };
  });
  console.error(`[acp-rig] arm=${ARM} fake openai ${server.baseUrl}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    QWEN_CODE_NO_RELAUNCH: '1',
    QWEN_SANDBOX: 'false',
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  for (const k of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy']) delete env[k];

  const child = spawn(
    'node',
    [
      join(DIST, 'cli.js'),
      '--acp',
      '--approval-mode', process.env['PROBE_APPROVAL'] ?? 'yolo',
      '--auth-type', 'openai',
      '--openai-api-key', 'dummy',
      '--openai-base-url', server.baseUrl,
      '--model', 'dummy',
    ],
    { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const stderrChunks: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => stderrChunks.push(d));

  let nextId = 1;
  const pending = new Map<number, (v: unknown) => void>();
  const updates: unknown[] = [];
  let racePermission: { reqId: number; allowId: string; options: unknown[] } | null = null;
  const rawIn: string[] = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      rawIn.push(line);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg['id'] === 'number' && ('result' in msg || 'error' in msg)) {
        const resolver = pending.get(msg['id'] as number);
        if (resolver) {
          pending.delete(msg['id'] as number);
          resolver(msg);
        }
        continue;
      }
      if (msg['method'] === 'session/update') {
        updates.push(msg['params']);
        continue;
      }
      // Any agent->client request: answer permissively.
      if (typeof msg['id'] === 'number' && msg['method']) {
        const method = String(msg['method']);
        let result: unknown = {};
        if (method === 'session/request_permission') {
          if (process.env['PROBE_RACE_PERMISSION'] === '1') {
            // R3-2 reachability probe: the host cancels the turn and only THEN
            // answers the outstanding permission request with an *approval*.
            // Two independent protocol messages -- no timing trick, no source
            // change. This is what a Zed user hitting Cancel while a
            // permission dialog is open produces.
            const p = (msg['params'] ?? {}) as Record<string, unknown>;
            const opts = (p['options'] ?? []) as Array<Record<string, unknown>>;
            const allow =
              opts.find((o) => String(o['kind'] ?? '').includes('allow')) ??
              opts.find((o) => String(o['optionId'] ?? '').includes('proceed')) ??
              opts[0];
            const allowId = String(allow?.['optionId'] ?? 'proceed_once');
            const reqId = msg['id'] as number;
            racePermission = { reqId, allowId, options: opts };
            console.error('[acp-rig] permission request held; optionId to send =', allowId);
            continue;
          }
          result = { outcome: { outcome: 'selected', optionId: 'proceed_always' } };
        } else if (method === 'fs/read_text_file') {
          result = { content: '' };
        }
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg['id'], result }) + '\n');
      }
    }
  });

  const call = (method: string, params: unknown): Promise<Record<string, unknown>> => {
    const id = nextId++;
    const p = new Promise<Record<string, unknown>>((resolve_) => {
      pending.set(id, resolve_ as (v: unknown) => void);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  };
  const notify = (method: string, params: unknown) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  const timeline: string[] = [];
  const stamp = (m: string) => {
    timeline.push(`${new Date().toISOString()} ${m}`);
    console.error('[acp-rig]', m);
  };

  try {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    stamp(`initialize -> ${JSON.stringify(init['result'] ?? init['error']).slice(0, 200)}`);

    const sess = await call('session/new', { cwd: workDir, mcpServers: [] });
    const sessionId = ((sess['result'] ?? {}) as Record<string, unknown>)['sessionId'];
    stamp(`session/new -> ${String(sessionId)}`);
    if (!sessionId) throw new Error(`session/new failed: ${JSON.stringify(sess)}`);

    const promptPromise = call('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'run the probe command' }],
    });

    if (process.env['PROBE_RACE_PERMISSION'] === '1') {
      const pdl = Date.now() + 60000;
      while (Date.now() < pdl && !racePermission) await sleep(150);
      stamp(`permission request held = ${JSON.stringify(racePermission)}`);
      notify('session/cancel', { sessionId });
      stamp('session/cancel sent BEFORE answering the permission');
      await sleep(1200);
      if (racePermission) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: racePermission.reqId,
            result: { outcome: { outcome: 'selected', optionId: racePermission.allowId } },
          }) + '\n',
        );
        stamp(`permission ANSWERED with allow (${racePermission.allowId}) on an already-cancelled turn`);
      }
    } else {
    // Wait for the shell tool to actually be executing.
    const deadline = Date.now() + 60000;
    let running = false;
    while (Date.now() < deadline) {
      if (JSON.stringify(updates).includes('PROBE_SHELL_STARTED')) {
        running = true;
        break;
      }
      await sleep(200);
    }
    stamp(`shell running observed = ${running}`);
    await sleep(1500);

    notify('session/cancel', { sessionId });
    stamp('session/cancel sent');
    }
    const promptResult = await Promise.race([
      promptPromise,
      sleep(30000).then(() => ({ result: { stopReason: 'TIMEOUT_IN_RIG' } })),
    ]);
    stamp(`session/prompt returned ${JSON.stringify((promptResult as Record<string, unknown>)['result'] ?? (promptResult as Record<string, unknown>)['error'])}`);

    const requestsAfterCancel = server.requests.length;
    stamp(`fake-openai requests after cancel = ${requestsAfterCancel}`);

    const follow = await Promise.race([
      call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'what happened?' }] }),
      sleep(45000).then(() => ({ result: { stopReason: 'TIMEOUT_IN_RIG' } })),
    ]);
    stamp(`follow-up prompt returned ${JSON.stringify((follow as Record<string, unknown>)['result'] ?? (follow as Record<string, unknown>)['error'])}`);
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    await sleep(800);
    writeFileSync(join(OUT, `${ARM}-acp-updates.json`), JSON.stringify(updates, null, 2));
    writeFileSync(join(OUT, `${ARM}-acp-stderr.log`), stderrChunks.join(''));
    writeFileSync(join(OUT, `${ARM}-acp-rawin.jsonl`), rawIn.join('\n'));
    writeFileSync(
      join(OUT, `${ARM}-acp-requests.json`),
      JSON.stringify(server.requests.map((r) => r.body), null, 2),
    );
    writeFileSync(join(OUT, `${ARM}-acp-timeline.txt`), timeline.join('\n') + '\n');
    await server.close();
  }

  const bodies = server.requests.map((r) => r.body as Record<string, unknown>);
  const toolMessages: Array<{ request: number; tool_call_id: unknown; content: unknown }> = [];
  bodies.forEach((body, i) => {
    const messages = body['messages'];
    if (!Array.isArray(messages)) return;
    for (const m of messages) {
      if (m && typeof m === 'object' && (m as Record<string, unknown>)['role'] === 'tool') {
        toolMessages.push({
          request: i + 1,
          tool_call_id: (m as Record<string, unknown>)['tool_call_id'],
          content: (m as Record<string, unknown>)['content'],
        });
      }
    }
  });
  const summary = { arm: ARM, surface: 'acp', dist: DIST, requestCount: bodies.length, toolMessages };
  writeFileSync(join(OUT, `${ARM}-acp-toolmessages.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
