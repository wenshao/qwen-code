// Usage: node harness.mjs <tree> <label>
// Real `qwen serve` daemon (tree's dist) + the tree's SDK over REST, ACP HTTP and ACP WS,
// against a loopback fake OpenAI provider that records every request body.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFakeProvider } from './fake-provider.mjs';

const [tree, label] = process.argv.slice(2);
const OUT = new URL('.', import.meta.url).pathname;
const TOKEN = 'verify-token-12308';
const M = 'qwen-startup-test(openai)';
const PLAIN = 'plain-model(openai)';
const results = [];
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${name}${detail ? C.d + '  ' + detail + C.x : ''}`);
}
function note(name, detail) {
  results.push({ name, ok: null, detail });
  console.log(`${C.y}OBS ${C.x} ${name}${C.d}  ${detail}${C.x}`);
}

const sdk = await import(pathToFileURL(join(tree, 'packages/sdk-typescript/dist/index.mjs')).href);
const tr = await import(pathToFileURL(join(tree, 'packages/sdk-typescript/dist/daemon/transports.js')).href);

const provider = await startFakeProvider();
const root = mkdtempSync(join(OUT, `run-${label}-`));
const home = join(root, 'home');
const ws = join(root, 'ws');
mkdirSync(join(home, '.qwen'), { recursive: true });
mkdirSync(ws, { recursive: true });
const baseUrl = `http://127.0.0.1:${provider.port}/v1`;
const settingsPath = join(home, '.qwen', 'settings.json');
writeFileSync(
  settingsPath,
  JSON.stringify(
    {
      model: { reasoningEffort: 'none' },
      security: { auth: { selectedType: 'openai' } },
      modelProviders: {
        openai: [
          {
            id: 'qwen-startup-test',
            name: 'Startup test',
            baseUrl,
            envKey: 'OPENAI_API_KEY',
            capabilities: {
              reasoning: { thinking: true, efforts: ['low', 'high'], defaultEffort: 'low', disableField: 'reasoning_effort' },
            },
          },
          { id: 'plain-model', name: 'Plain', baseUrl, envKey: 'OPENAI_API_KEY' },
        ],
      },
      $version: 4,
    },
    null,
    2,
  ),
);

const env = { ...process.env, HOME: home, QWEN_HOME: join(home, '.qwen'), QWEN_RUNTIME_DIR: join(root, 'runtime'),
  OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: 'plain-model', QWEN_MODEL: 'plain-model' };
for (const k of Object.keys(env)) if (k.startsWith('QWEN_SERVE_')) delete env[k];
const daemon = spawn(process.execPath, [join(tree, 'packages/cli/dist/index.js'), 'serve', '--port', '0', '--token', TOKEN,
  '--hostname', '127.0.0.1', '--workspace', ws, '--no-web'], { env, cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
daemon.stderr.on('data', (c) => (stderr += c));
const port = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('boot timeout\n' + buf + stderr)), 60000);
  daemon.stdout.on('data', (c) => {
    buf += c;
    const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) { clearTimeout(t); resolve(Number(m[1])); }
  });
  daemon.on('exit', (code) => reject(new Error('daemon exited ' + code + '\n' + stderr)));
});
const base = `http://127.0.0.1:${port}`;
await new Promise((r) => setTimeout(r, 1000));
const settingsBefore = readFileSync(settingsPath, 'utf8'); // after boot-time $version migration
console.log(`${C.b}${C.c}== PR #12308 startupConfig harness — arm: ${label} (${tree.split('/').pop()}) daemon :${port}${C.x}`);

const rpcLog = [];
const loggingFetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!String(input).includes('/acp') || !res.body) return res;
  const entry = { req: init?.body ? String(init.body) : '', res: '' };
  rpcLog.push(entry);
  const [a, b] = res.body.tee();
  (async () => { const dec = new TextDecoder(); try { for await (const c of b) entry.res += dec.decode(c, { stream: true }); } catch {} })();
  return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
};
function makeClient(kind) {
  if (kind === 'rest') return new sdk.DaemonClient({ baseUrl: base, token: TOKEN });
  if (kind === 'acp-http') return new sdk.DaemonClient({ baseUrl: base, token: TOKEN, transport: new tr.AcpHttpTransport(base, TOKEN, loggingFetch) });
  return new sdk.DaemonClient({ baseUrl: base, token: TOKEN, transport: new tr.AcpWsTransport(base.replace('http:', 'ws:') + '/acp', TOKEN) });
}
const kindOf = (e) => e?.body?.code ?? e?.body?.data?.errorKind;
const errInfo = (e) => ({ name: e?.name, status: e?.status, code: e?.body?.code ?? e?.code, bodyKeys: e?.body && typeof e.body === 'object' ? Object.keys(e.body) : undefined, errorKind: e?.body?.errorKind ?? e?.body?.data?.errorKind, msg: String(e?.message).slice(0, 70) });
const lastUser = (b) => JSON.stringify([...(b.messages ?? [])].reverse().find((m) => m.role === 'user') ?? '');
function turnRequests(probe) {
  return provider.requests.filter((r) => r.url.includes('chat/completions') && Array.isArray(r.body.tools) && lastUser(r.body).includes(probe));
}
const rest = makeClient('rest');
async function listIds() {
  return (await rest.listWorkspaceSessions(ws, { pageSize: 1000 })).map((s) => s.sessionId);
}
function chatFiles() {
  const out = [];
  const walk = (d) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl') && p.includes('chats')) out.push(e.name); } };
  walk(join(home, '.qwen'));
  walk(join(root, 'runtime'));
  return out.sort();
}
const text = (t) => ({ prompt: [{ type: 'text', text: t }] });

for (const kind of ['rest', 'acp-http', 'acp-ws']) {
  console.log(`${C.b}-- transport: ${kind}${C.x}`);
  const client = makeClient(kind);
  // S1: model + high, applied and confirmed, carried on the wire across two turns
  try {
    const s = await client.createOrAttachSession({ workspaceCwd: ws, startupConfig: { modelServiceId: M, reasoningEffort: 'high' } });
    check(`[${kind}] S1 create {model, high} confirmed`, s.modelApplied === true && s.startupConfigApplied?.reasoningEffort === 'high' && s.startupConfigApplied?.modelServiceId === M,
      JSON.stringify({ modelApplied: s.modelApplied, applied: s.startupConfigApplied }));
    for (const turn of [1, 2]) {
      const probe = `probe-${label}-${kind}-t${turn}`;
      await client.prompt(s.sessionId, text(probe), undefined, s.clientId);
      const reqs = turnRequests(probe);
      const sig = reqs.map((r) => `${r.body.model}:${r.body.reasoning_effort ?? '∅'}`);
      check(`[${kind}] S1 turn ${turn} wire model/effort`, reqs.length > 0 && reqs.every((r) => r.body.model === 'qwen-startup-test' && r.body.reasoning_effort === 'high'), sig.join(' '));
    }
    await rest.closeSession(s.sessionId);
  } catch (e) { check(`[${kind}] S1`, false, JSON.stringify(errInfo(e))); }
  // S2: model-only on a model without reasoning controls
  try {
    const s = await client.createOrAttachSession({ workspaceCwd: ws, startupConfig: { modelServiceId: PLAIN } });
    const keys = Object.keys(s.startupConfigApplied ?? {});
    const probe = `probe-${label}-${kind}-plain`;
    await client.prompt(s.sessionId, text(probe), undefined, s.clientId);
    const reqs = turnRequests(probe);
    check(`[${kind}] S2 model-only on no-reasoning model`, s.modelApplied === true && keys.join() === 'modelServiceId' && reqs.length > 0 && reqs.every((r) => r.body.model === 'plain-model' && !('reasoning_effort' in r.body)),
      `applied keys=[${keys}] wire=${reqs.map((r) => `${r.body.model}:${r.body.reasoning_effort ?? '∅'}`).join(' ')}`);
    await rest.closeSession(s.sessionId);
  } catch (e) { check(`[${kind}] S2`, false, JSON.stringify(errInfo(e))); }
  // S3: definite rejection WITHOUT a caller-supplied id — must not leave a listed phantom
  {
    const before = new Set(await listIds());
    const filesBefore = chatFiles();
    let err;
    try { await client.createOrAttachSession({ workspaceCwd: ws, startupConfig: { modelServiceId: M, reasoningEffort: 'max' } }); } catch (e) { err = errInfo(e); }
    await new Promise((r) => setTimeout(r, 500));
    const phantoms = (await listIds()).filter((id) => !before.has(id));
    const newFiles = chatFiles().filter((f) => !filesBefore.includes(f));
    note(`[${kind}] S3 error body shape`, `body.code=${err?.code ?? '∅'} body.data.errorKind=${err?.errorKind ?? '∅'}`);
    check(`[${kind}] S3 'max' rejected as 422 startup_config_rejected`, err?.status === 422 && (err?.code ?? err?.errorKind) === 'startup_config_rejected', JSON.stringify(err));
    check(`[${kind}] S3 no daemon-generated phantom session listed`, phantoms.length === 0, `new listed=${JSON.stringify(phantoms)} new recordings=${JSON.stringify(newFiles)}`);
  }
  // S4: control character inside the model id
  {
    const before = new Set(await listIds());
    let err, ok;
    try { ok = await client.createOrAttachSession({ workspaceCwd: ws, startupConfig: { modelServiceId: 'qwen-startup-test\n(openai)' } }); } catch (e) { err = errInfo(e); }
    await new Promise((r) => setTimeout(r, 300));
    const phantoms = (await listIds()).filter((id) => !before.has(id));
    check(`[${kind}] S4 control-char model id → 400 invalid_startup_config`, !ok && err?.status === 400 && (err?.code ?? err?.errorKind) === 'invalid_startup_config', JSON.stringify(err ?? { created: ok?.sessionId }));
    check(`[${kind}] S4 no session left behind`, phantoms.length === 0, `new listed=${JSON.stringify(phantoms)}`);
  }
  try { await client.dispose?.(); } catch {}
}

// S5: raw JSON-RPC error code for the definite rejection on ACP HTTP
{
  const rejected = rpcLog.filter((l) => l.req.includes('session/new'));
  const codes = [];
  for (const l of rpcLog) {
    for (const m of l.res.matchAll(/"error":\{"code":(-?\d+)[^}]*?"errorKind":"(startup_config_rejected|invalid_startup_config)"/g)) codes.push(`${m[2]}→${m[1]}`);
  }
  check(`[acp-http] S5 raw JSON-RPC code for startup_config_rejected is -32602 (client fault)`, codes.some((c) => c === 'startup_config_rejected→-32602'), `seen: ${[...new Set(codes)].join(', ') || 'none'} (session/new max reqs=${rejected.length})`);
}
// S6: SDK local validation error carries the stable code
try {
  await rest.createOrAttachSession({ workspaceCwd: ws, startupConfig: { modelServiceId: '' } });
  check('[sdk] S6 local malformed rejection', false, 'no throw');
} catch (e) {
  check('[sdk] S6 local malformed rejection: TypeError with code invalid_startup_config', e instanceof TypeError && e.code === 'invalid_startup_config', `${e?.constructor?.name} code=${e?.code}`);
}
// S7: shared settings untouched
{ const after = readFileSync(settingsPath, 'utf8'); writeFileSync(join(root, 'settings.before.json'), settingsBefore); writeFileSync(join(root, 'settings.after.json'), after);
  check('S7 shared settings.json byte-identical after all creations', after === settingsBefore, `${settingsBefore.length}B → ${after.length}B`); }

daemon.kill('SIGTERM');
provider.server.close();
const pass = results.filter((r) => r.ok === true).length, fail = results.filter((r) => r.ok === false).length;
console.log(`${C.b}== ${label}: ${pass} pass, ${fail} fail${C.x}`);
writeFileSync(join(OUT, `results-${label}.json`), JSON.stringify({ tree, results, requests: provider.requests.length }, null, 2));
setTimeout(() => process.exit(0), 500);
