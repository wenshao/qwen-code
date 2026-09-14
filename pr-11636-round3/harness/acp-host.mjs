// Raw ndjson JSON-RPC ACP host that SILENTLY DROPS `_qwencode/start_turn`.
// Models a non-conforming third-party ACP host: it never answers that
// extension request (no result, no error). Everything else is answered.
//
// Usage: ARM=head|pre node acp-host.mjs <label> [--answer-start-turn]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ARM = process.env.ARM || 'head';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad';
const WT = ARM === 'pre' ? `${S}/wtPRE` : `${S}/wtHEAD`;
const MOCK_PORT = ARM === 'pre' ? 18657 : 18656;
const H = `${S}/h`;
const label = process.argv[2] || 'acp';
const ANSWER = process.argv.includes('--answer-start-turn');
const HOME_Q = `${H}/acphome-${ARM}`;
const WS = `${H}/acpws-${ARM}`;
fs.mkdirSync(`${HOME_Q}/.qwen`, { recursive: true });
fs.mkdirSync(WS, { recursive: true });
fs.copyFileSync(`${H}/settings.json`, `${HOME_Q}/.qwen/settings.json`);

const T0 = Date.now();
const rel = (t = Date.now()) => ((t - T0) / 1000).toFixed(2);
const log = [];
const say = (m, x) => {
  const row = { t: rel(), m, ...(x || {}) };
  log.push(row);
  console.log(`[+${row.t}s] ${m}`, x ? JSON.stringify(x).slice(0, 300) : '');
};

await fetch(`http://127.0.0.1:${MOCK_PORT}/__run`, {
  method: 'POST',
  body: JSON.stringify({ label: `${ARM}-${label}` }),
}).catch(() => {});

const child = spawn(process.execPath, [`${WT}/dist/cli.js`, '--acp'], {
  cwd: WS,
  env: {
    ...process.env,
    HOME: HOME_Q,
    QWEN_RUNTIME_DIR: `${H}/acprt-${ARM}`,
    OPENAI_API_KEY: 'mock-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    OPENAI_MODEL: 'mock-model',
    NO_COLOR: '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const stderr = [];
child.stderr.on('data', (b) => {
  const s = String(b);
  stderr.push(s);
});

let nextId = 1;
const pending = new Map();
const seen = { startTurn: [], permission: 0, updates: 0 };
const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const request = (method, params) => {
  const id = nextId++;
  const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  send({ jsonrpc: '2.0', id, method, params });
  return p;
};
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });

let buf = '';
child.stdout.on('data', (b) => {
  buf += String(b);
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});

function handle(msg) {
  if (msg.id !== undefined && msg.method === undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (!p) return;
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
    return;
  }
  const { method, params, id } = msg;
  if (method === 'session/update') {
    seen.updates++;
    const u = params?.update ?? {};
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.text)
      say('update:text', { text: String(u.content.text).slice(0, 80) });
    else if (u.sessionUpdate === 'tool_call')
      say('update:tool_call', { title: u.title, id: u.toolCallId });
    return;
  }
  if (method === '_qwencode/start_turn') {
    seen.startTurn.push({ t: rel(), params: { source: params?.source, turnId: params?.turnId } });
    say('RECEIVED _qwencode/start_turn -> ' + (ANSWER ? 'ANSWERING accepted' : 'DROPPING (no reply ever)'), {
      source: params?.source,
    });
    if (ANSWER && id !== undefined) reply(id, { accepted: true });
    return; // silently drop otherwise
  }
  if (method === 'session/request_permission') {
    seen.permission++;
    const opts = params?.options ?? [];
    const allow = opts.find((o) => /allow/i.test(o.kind ?? o.optionId ?? '')) ?? opts[0];
    say('permission -> allow', { tool: params?.toolCall?.title, opt: allow?.optionId });
    reply(id, { outcome: { outcome: 'selected', optionId: allow?.optionId } });
    return;
  }
  if (id !== undefined) {
    // Any other client-side method the agent asks for: answer minimally so
    // nothing else can be blamed for a stall.
    say('other request', { method });
    reply(id, {});
  }
}

const timeout = (p, ms, tag) =>
  Promise.race([
    p.then((v) => ({ ok: true, v })),
    new Promise((r) => setTimeout(() => r({ ok: false, tag, timedOutAfterMs: ms }), ms)),
  ]);

const out = { arm: ARM, label, answerStartTurn: ANSWER, log, seen };
try {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  say('initialize ok', { pv: init?.protocolVersion });
  const s = await request('session/new', { cwd: WS, mcpServers: [] });
  const sid = s.sessionId;
  out.sessionId = sid;
  say('session/new ok', { sid });

  const t1 = Date.now();
  const p1 = await timeout(
    request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: '[[S:idle]] launch a background probe' }] }),
    60000,
    'prompt1',
  );
  out.prompt1 = { ...p1, ms: Date.now() - t1 };
  say('prompt1 settled', out.prompt1);

  // Wait for the background agent to finish and the admission attempt.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && seen.startTurn.length === 0) await new Promise((r) => setTimeout(r, 200));
  out.startTurnSeenAfterMs = seen.startTurn.length ? Date.now() - t1 : null;
  say('admission attempt observed?', { count: seen.startTurn.length });

  // The oracle: with the admission await wedged, does the pipeline recover?
  await new Promise((r) => setTimeout(r, 6000));
  const t2 = Date.now();
  const p2 = await timeout(
    request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: '[[S:after]] are you still alive?' }] }),
    45000,
    'prompt2',
  );
  out.prompt2 = { ...p2, ms: Date.now() - t2 };
  say('prompt2 settled', out.prompt2);

  const mock = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__log`)).json();
  out.mock = mock.map((r) => ({ seq: r.seq, kind: r.kind, scenario: r.scenario, step: r.step, notifs: r.notifs, reply: r.reply }));
  out.notificationReachedModel = mock.some((r) => r.kind === 'parent' && (r.notifs ?? []).length > 0);
  say('mock summary', { requests: mock.length, notificationReachedModel: out.notificationReachedModel });
} catch (e) {
  out.error = String(e).slice(0, 400);
  say('ERROR', { e: out.error });
}
out.stderrTail = stderr.join('').split('\n').filter((l) => /start_turn|background|admission|notification/i.test(l)).slice(-25);
fs.mkdirSync(`${H}/out/acp`, { recursive: true });
fs.writeFileSync(path.join(`${H}/out/acp`, `${ARM}-${label}.json`), JSON.stringify(out, null, 1));
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({
  arm: ARM,
  startTurnRequests: out.seen.startTurn.length,
  prompt1: out.prompt1?.ok ? `ok in ${out.prompt1.ms}ms` : `TIMED OUT after ${out.prompt1?.timedOutAfterMs}ms`,
  prompt2: out.prompt2?.ok ? `ok in ${out.prompt2.ms}ms` : `TIMED OUT after ${out.prompt2?.timedOutAfterMs}ms`,
  notificationReachedModel: out.notificationReachedModel,
}, null, 1));
child.kill('SIGKILL');
process.exit(0);
