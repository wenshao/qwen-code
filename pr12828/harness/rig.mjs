// Real-process rig for PR #12828 (paired engines wired into ordinary hosts).
// Drives the bundled `qwen serve` (<WT>/dist/cli.js) over HTTP with an isolated
// HOME, a trusted-folders file and a local fake model. Legacy runs as the real
// `qwen --acp` child the daemon spawns. Observations are written to OUT/obs.json
// and printed as `OBS` lines.
//
// PLAN selects the phase list:
//   head    P1 paired → P2 unpaired (same storage) → P3 paired → P4 fresh paired
//           (Managed load as first request) → P5 Hosted rejection
//   single  one unpaired run of the P1 script (for head-vs-base "off = unchanged")
//   base    single + the flag rejection
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { startFakeModel } from './fake-model.mjs';

const WT = process.env.WT;
const ARM = process.env.ARM ?? path.basename(WT);
const PLAN = process.env.PLAN ?? 'head';
const OUT = path.resolve(process.env.OUT);
const CLI = path.join(WT, 'dist/cli.js');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const HOME = path.join(OUT, 'home');
const QDIR = path.join(HOME, '.qwen');
fs.mkdirSync(QDIR, { recursive: true });
const mk = (p) => { fs.mkdirSync(p, { recursive: true }); return fs.realpathSync(p); };
const WS = { A: mk(path.join(OUT, 'ws/alpha')), B: mk(path.join(OUT, 'ws/beta')), C: mk(path.join(OUT, 'ws/gamma')) };
// Secondary and dynamic workspaces keep their sessions in their own runtime
// directory, so an owner read from the primary's storage cannot find them.
for (const k of ['B', 'C']) {
  fs.mkdirSync(path.join(WS[k], '.qwen'), { recursive: true });
  fs.writeFileSync(path.join(WS[k], '.qwen/settings.json'), JSON.stringify({ advanced: { runtimeOutputDir: '.rt' } }, null, 2));
}
const RT = { A: QDIR, B: path.join(WS.B, '.rt'), C: path.join(WS.C, '.rt') };
fs.writeFileSync(path.join(QDIR, 'settings.json'), JSON.stringify({
  security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: true } },
  model: { name: 'fake-model' },
  general: { enableAutoUpdate: false },
  tools: { approvalMode: 'yolo' },
}, null, 2));
fs.writeFileSync(path.join(QDIR, 'trustedFolders.json'), JSON.stringify(Object.fromEntries(Object.values(WS).map((p) => [p, 'TRUST_FOLDER'])), null, 2));

const model = await startFakeModel('fake-model');
const obs = [];
const log = (phase, step, key, value) => {
  const o = { phase, step, key, value };
  obs.push(o);
  console.log('OBS', phase, step, key, typeof value === 'string' ? value : JSON.stringify(value));
  fs.writeFileSync(path.join(OUT, 'obs.json'), JSON.stringify(obs, null, 2));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

function descendants(pid) {
  let rows;
  try { rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args=']).toString().trim().split('\n'); } catch { return []; }
  const procs = rows.map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], args: m[3] }; }).filter(Boolean);
  const out = []; const q = [pid];
  while (q.length) { const p = q.shift(); for (const c of procs) if (c.ppid === p) { out.push(c); q.push(c.pid); } }
  return out;
}
const acpChildren = (pid) => descendants(pid).filter((p) => /\s--acp(\s|$)/.test(p.args));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function startDaemon(phase, { paired, extraArgs = [], expectExit = false, workspaces = ['A', 'B'] }) {
  const port = await freePort();
  const args = [CLI, 'serve', '--port', String(port), '--hostname', '127.0.0.1',
    ...workspaces.flatMap((k) => ['--workspace', WS[k]]),
    ...(paired ? ['--experimental-paired-engines'] : []), ...extraArgs];
  const env = {
    PATH: process.env.PATH, HOME, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8',
    OPENAI_API_KEY: 'rig-key', OPENAI_BASE_URL: model.url, OPENAI_MODEL: 'fake-model',
    NO_PROXY: '*', QWEN_TELEMETRY_ENABLED: 'false',
  };
  const logFile = path.join(OUT, `${phase}${paired ? '' : '-noflag'}${extraArgs.length ? '-x' : ''}.daemon.log`);
  const fd = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, args, { cwd: WS.A, env, stdio: ['ignore', fd, fd] });
  const d = { phase, port, child, pid: child.pid, base: `http://127.0.0.1:${port}`, logFile, seenAcp: new Set(), exit: null };
  d.exited = new Promise((r) => child.on('exit', (code, signal) => { d.exit = { code, signal, at: Date.now() }; r(d.exit); }));
  log(phase, 'start', 'argv', args.slice(2).map((a) => a.replace(OUT, '$OUT')).join(' '));
  if (expectExit) {
    const e = await Promise.race([d.exited, sleep(90_000).then(() => null)]);
    return { d, exit: e, output: fs.readFileSync(logFile, 'utf8') };
  }
  const t0 = Date.now();
  for (;;) {
    if (d.exit) throw new Error(`daemon exited early: ${JSON.stringify(d.exit)}\n${fs.readFileSync(logFile, 'utf8').slice(-3000)}`);
    try {
      const r = await fetch(`${d.base}/capabilities`);
      if (r.status === 200) break;
    } catch {}
    if (Date.now() - t0 > 180_000) throw new Error('daemon not ready');
    await sleep(300);
  }
  log(phase, 'start', 'readyMs', Date.now() - t0);
  return d;
}

async function req(d, method, url, body, { retry503 = true } = {}) {
  for (let i = 0; ; i++) {
    const r = await fetch(d.base + url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (retry503 && r.status === 503 && json?.code === 'daemon_runtime_starting' && i < 100) { await sleep(300); continue; }
    for (const c of acpChildren(d.pid)) d.seenAcp.add(c.pid);
    return { status: r.status, json };
  }
}

function findTranscript(root, id) {
  const hits = [];
  const walk = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 8) walk(p, depth + 1);
      else if (e.isFile() && e.name === `${id}.jsonl`) hits.push(p);
    }
  };
  walk(root, 0);
  return hits;
}
const records = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const shape = (r) => r.subtype ? `${r.type}/${r.subtype}${r.subtype === 'session_execution_engine' ? `(${r.systemPayload?.engine})` : ''}` : r.type;
const ownerCount = (recs) => recs.filter((r) => r.subtype === 'session_execution_engine').length;

async function waitTurn(file, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (file && fs.existsSync(file) && records(file).some((r) => r.type === 'assistant')) return true;
    await sleep(250);
  }
  return false;
}

async function stopEngines(d, cwd) {
  const r = await req(d, 'GET', '/workspaces/runtime-stop-options');
  if (r.status !== 200) return `HTTP ${r.status} ${r.json?.code ?? ''}`;
  const w = r.json.workspaces.find((x) => x.cwd === cwd);
  if (!w) return 'workspace not listed';
  return (w.channels ?? []).map((c) => c.executionEngine ?? '(none)');
}

// One ordinary session through create → prompt → close → cold load.
async function sessionCycle(d, phase, wsKey, { note = '' } = {}) {
  const step = `${wsKey}${note}`;
  const cwd = WS[wsKey];
  const c = await req(d, 'POST', '/session', { cwd });
  log(phase, step, 'create', c.status === 200 ? 200 : `${c.status} ${JSON.stringify(c.json).slice(0, 200)}`);
  if (c.status !== 200) return {};
  const id = c.json.sessionId;
  const hits = findTranscript(RT[wsKey], id);
  const other = Object.entries(RT).filter(([k]) => k !== wsKey && RT[k] !== RT[wsKey]).flatMap(([, dir]) => findTranscript(dir, id));
  log(phase, step, 'transcriptBeforePrompt', hits.length ? records(hits[0]).map(shape) : 'absent');
  if (other.length) log(phase, step, 'transcriptInOtherStorage', other.map((p) => p.replace(OUT, '$OUT')));
  const p = await req(d, 'POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text: `hello from ${step}` }] });
  log(phase, step, 'prompt', p.status);
  let file = findTranscript(RT[wsKey], id)[0];
  const t0 = Date.now();
  while (!file && Date.now() - t0 < 30_000) { await sleep(250); file = findTranscript(RT[wsKey], id)[0]; }
  const done = await waitTurn(file);
  const recs = file ? records(file) : [];
  log(phase, step, 'afterPrompt', { turnDone: done, first: recs[0] && shape(recs[0]), owners: ownerCount(recs), shapes: [...new Set(recs.map(shape))] });
  log(phase, step, 'engines', await stopEngines(d, cwd));
  const del = await req(d, 'DELETE', `/session/${id}`);
  log(phase, step, 'close', del.status);
  const ld = await req(d, 'POST', `/session/${id}/load`, { cwd });
  log(phase, step, 'coldLoad', ld.status === 200 ? 200 : `${ld.status} ${ld.json?.code ?? ''} ${String(ld.json?.error ?? '').slice(0, 160)}`);
  const after = file ? records(file) : [];
  log(phase, step, 'afterLoad', { owners: ownerCount(after), first: after[0] && shape(after[0]) });
  await req(d, 'DELETE', `/session/${id}`);
  return { id, file, cwd, wsKey };
}

// A transcript whose owner record names managed: the prompted Legacy
// transcript under a new id, owner switched (or prepended when it has none).
function plantManaged(src, wsKey) {
  const id = crypto.randomUUID();
  const recs = records(src.file).map((r) => ({ ...r, sessionId: id }));
  const i = recs.findIndex((r) => r.subtype === 'session_execution_engine');
  if (i >= 0) recs[i] = { ...recs[i], systemPayload: { version: 1, engine: 'managed' } };
  else {
    const tpl = JSON.parse(fs.readFileSync(new URL('./owner-template.json', import.meta.url), 'utf8'));
    recs.unshift({ ...tpl, uuid: crypto.randomUUID(), sessionId: id, cwd: recs[0].cwd, timestamp: recs[0].timestamp, systemPayload: { version: 1, engine: 'managed' } });
    recs[1] = { ...recs[1], parentUuid: recs[0].uuid };
  }
  const file = path.join(path.dirname(src.file), `${id}.jsonl`);
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { id, file, cwd: WS[wsKey] };
}

async function managedRefusal(d, phase, m, label) {
  const before = sha(m.file);
  const kids0 = acpChildren(d.pid).map((c) => c.pid);
  for (const op of ['load', 'resume']) {
    const r = await req(d, 'POST', `/session/${m.id}/${op}`, { cwd: m.cwd });
    log(phase, label, `managed.${op}`, r.status === 200 ? 200 : `${r.status} ${r.json?.code ?? ''} | ${String(r.json?.error ?? '').slice(0, 170)}`);
    if (r.status === 200) await req(d, 'DELETE', `/session/${m.id}`);
  }
  const kids1 = acpChildren(d.pid).map((c) => c.pid);
  log(phase, label, 'managed.bytes', before === sha(m.file) ? `unchanged ${before}` : `CHANGED ${before} -> ${sha(m.file)}`);
  log(phase, label, 'managed.acpChildren', { before: kids0.length, after: kids1.length, new: kids1.filter((p) => !kids0.includes(p)).length });
}

async function stop(d, phase) {
  const t0 = Date.now();
  const seen = [...d.seenAcp, ...acpChildren(d.pid).map((c) => c.pid)];
  d.child.kill('SIGTERM');
  const e = await Promise.race([d.exited, sleep(60_000).then(() => null)]);
  await sleep(500);
  const leftover = [...new Set(seen)].filter(alive);
  log(phase, 'shutdown', 'SIGTERM', { exit: e?.code ?? 'timeout', signal: e?.signal ?? null, ms: Date.now() - t0, acpChildrenSeen: new Set(seen).size, leftover: leftover.length });
  for (const p of leftover) { try { process.kill(p, 'SIGKILL'); } catch {} }
  if (!e) { try { d.child.kill('SIGKILL'); } catch {} }
}

const state = {};
async function phaseMain(phase, paired) {
  const d = await startDaemon(phase, { paired });
  try {
    const caps = await req(d, 'GET', '/capabilities');
    log(phase, 'caps', 'workspaces', (caps.json.workspaces ?? []).map((w) => `${w.kind ?? '?'}:${path.basename(w.cwd ?? w.path ?? '?')}${w.primary ? '*' : ''}`));
    state.a = await sessionCycle(d, phase, 'A');
    // an owner-only session: created, never prompted
    const oo = await req(d, 'POST', '/session', { cwd: WS.A });
    state.ownerOnly = oo.json?.sessionId;
    const ooFile = state.ownerOnly && findTranscript(RT.A, state.ownerOnly)[0];
    log(phase, 'A-unused', 'transcript', ooFile ? records(ooFile).map(shape) : 'absent');
    if (state.ownerOnly) await req(d, 'DELETE', `/session/${state.ownerOnly}`);
    state.b = await sessionCycle(d, phase, 'B');
    const add = await req(d, 'POST', '/workspaces', { cwd: WS.C });
    log(phase, 'C', 'addWorkspace', add.status === 200 || add.status === 201 ? add.status : `${add.status} ${JSON.stringify(add.json).slice(0, 200)}`);
    state.c = await sessionCycle(d, phase, 'C');
    for (const k of ['a', 'b', 'c']) {
      if (!state[k]?.file) continue;
      state[`m${k}`] = plantManaged(state[k], k.toUpperCase());
      await managedRefusal(d, phase, state[`m${k}`], `${k.toUpperCase()}-managed`);
    }
    // Conversations runtime: daemon-owned standalone session
    const sid = crypto.randomUUID();
    const st = await req(d, 'POST', '/standalone/sessions', { sessionId: sid });
    log(phase, 'standalone', 'create', st.status === 200 ? 200 : `${st.status} ${JSON.stringify(st.json).slice(0, 200)}`);
    if (st.status === 200) {
      const hits = findTranscript(HOME, sid);
      log(phase, 'standalone', 'transcriptAfterCreate', hits.length ? records(hits[0]).map(shape) : 'absent');
      const p = await req(d, 'POST', `/session/${sid}/prompt`, { prompt: [{ type: 'text', text: 'hello standalone' }] });
      log(phase, 'standalone', 'prompt', p.status);
      let f = findTranscript(HOME, sid)[0];
      const t0 = Date.now();
      while (!f && Date.now() - t0 < 30_000) { await sleep(250); f = findTranscript(HOME, sid)[0]; }
      const done = await waitTurn(f);
      const recs = f ? records(f) : [];
      log(phase, 'standalone', 'afterPrompt', { turnDone: done, owners: ownerCount(recs), first: recs[0] && shape(recs[0]), where: f ? path.dirname(f).replace(HOME, '$HOME') : null });
    }
    // Workspace deny rule and settings reload with only Legacy live.
    const perm = await req(d, 'POST', '/workspace/permissions', { scope: 'workspace', ruleType: 'deny', rules: ['Bash(touch *)'] });
    log(phase, 'deny', 'permissions', perm.status === 200 ? 200 : `${perm.status} ${JSON.stringify(perm.json).slice(0, 200)}`);
    const wsSettings = path.join(WS.A, '.qwen/settings.json');
    log(phase, 'deny', 'ruleSaved', fs.existsSync(wsSettings) && fs.readFileSync(wsSettings, 'utf8').includes('Bash(touch *)'));
    const rl = await req(d, 'POST', '/workspace/reload', {});
    log(phase, 'deny', 'reload', rl.status === 200 ? { status: 200, keys: Object.keys(rl.json ?? {}), partial: rl.json?.partial ?? rl.json?.partiallyApplied ?? null } : `${rl.status} ${JSON.stringify(rl.json).slice(0, 200)}`);
    const t = await req(d, 'POST', '/session', { cwd: WS.A });
    if (t.status === 200) {
      const tid = t.json.sessionId;
      await req(d, 'POST', `/session/${tid}/prompt`, { prompt: [{ type: 'text', text: 'please TOUCH-denied' }] });
      let f = findTranscript(RT.A, tid)[0];
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        f = findTranscript(RT.A, tid)[0];
        if (f && records(f).filter((r) => r.type === 'assistant').length >= 2) break;
        await sleep(300);
      }
      const recs = f ? records(f) : [];
      const toolResults = recs.filter((r) => r.type === 'tool_result').map((r) => JSON.stringify(r).match(/denied|deny|not allowed|blocked|permission/i)?.[0] ?? 'ran');
      log(phase, 'deny', 'touchAttempt', { marker: fs.existsSync(path.join(WS.A, 'denied.marker')), toolResults });
      await req(d, 'DELETE', `/session/${tid}`);
    }
    // remove the rule so later phases start clean
    fs.mkdirSync(path.dirname(wsSettings), { recursive: true });
    fs.writeFileSync(wsSettings, '{}\n');
  } finally {
    await stop(d, phase);
  }
}

async function phaseRestore(phase, paired, targets) {
  const d = await startDaemon(phase, { paired });
  try {
    for (const [label, t] of targets) {
      if (!t?.id) continue;
      const kids0 = acpChildren(d.pid).length;
      const r = await req(d, 'POST', `/session/${t.id}/load`, { cwd: t.cwd });
      const file = t.file ?? findTranscript(RT[t.wsKey ?? 'A'], t.id)[0];
      const recs = file && fs.existsSync(file) ? records(file) : [];
      log(phase, label, 'load', { status: r.status, code: r.json?.code ?? null, owners: ownerCount(recs), firstOwner: recs.find((x) => x.subtype === 'session_execution_engine')?.systemPayload?.engine ?? null, acpBefore: kids0, acpAfter: acpChildren(d.pid).length });
      if (r.status === 200) await req(d, 'DELETE', `/session/${t.id}`);
    }
    if (phase === 'P2') {
      // a session created while unpaired
      const u = await req(d, 'POST', '/session', { cwd: WS.A });
      const id = u.json?.sessionId;
      log(phase, 'U', 'transcriptBeforePrompt', id && findTranscript(RT.A, id)[0] ? records(findTranscript(RT.A, id)[0]).map(shape) : 'absent');
      await req(d, 'POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text: 'hello unpaired' }] });
      let f; const t0 = Date.now();
      while (!f && Date.now() - t0 < 30_000) { await sleep(250); f = findTranscript(RT.A, id)[0]; }
      await waitTurn(f);
      const recs = f ? records(f) : [];
      log(phase, 'U', 'afterPrompt', { owners: ownerCount(recs), first: recs[0] && shape(recs[0]) });
      log(phase, 'U', 'engines', await stopEngines(d, WS.A));
      await req(d, 'DELETE', `/session/${id}`);
      state.u = { id, file: f, cwd: WS.A, wsKey: 'A' };
    }
  } finally {
    await stop(d, phase);
  }
}

// Fresh paired daemon whose first session request is the Managed-owned load.
async function phaseFirstRequest(phase) {
  const d = await startDaemon(phase, { paired: true });
  try {
    log(phase, 'idle', 'acpChildrenAtStart', acpChildren(d.pid).length);
    await managedRefusal(d, phase, state.ma, 'A-managed-first');
    const r = await req(d, 'POST', `/session/${state.a.id}/load`, { cwd: WS.A });
    log(phase, 'A-legacy-next', 'load', { status: r.status, acpChildren: acpChildren(d.pid).length });
  } finally {
    await stop(d, phase);
  }
}

const HOSTED_ARGS = ['--profile', 'hosted-harness', '--token', 'rig-hosted-token-0123456789abcdef', '--no-web', '--hosted-harness-capability-digest', `sha256:${'a'.repeat(64)}`];
async function phaseHosted(phase, paired) {
  const r = await startDaemon(phase, { paired, workspaces: ['A'], extraArgs: HOSTED_ARGS, expectExit: true });
  const { exit, output } = r;
  const line = output.split('\n').find((l) => /does not|Unknown argument|Error/i.test(l)) ?? output.split('\n').find((l) => /listening on/.test(l)) ?? output.trim().split('\n').at(-1);
  log(phase, paired ? 'hosted+flag' : 'hosted-noflag', 'exit', { code: exit ? exit.code : 'still running after 90s', line: line?.slice(0, 200) });
  if (!exit) { r.d.child.kill('SIGTERM'); await Promise.race([r.d.exited, sleep(30_000)]); }
}

// Trust change: the dynamic runtime C is replaced twice (untrusted, then
// trusted again). The final replacement must be paired and read C's storage.
async function phaseReplacement(phase) {
  const d = await startDaemon(phase, { paired: true });
  const tf = path.join(QDIR, 'trustedFolders.json');
  const setTrust = (v) => { const j = JSON.parse(fs.readFileSync(tf, 'utf8')); j[WS.C] = v; fs.writeFileSync(tf, JSON.stringify(j, null, 2)); };
  const trustedC = async () => (await req(d, 'GET', '/capabilities')).json.workspaces?.find((w) => w.cwd === WS.C)?.trusted;
  const waitTrust = async (want) => { const t0 = Date.now(); while (Date.now() - t0 < 60_000) { if ((await trustedC()) === want) return Date.now() - t0; await req(d, 'POST', '/workspace/reload', {}); await sleep(500); } return 'timeout'; };
  try {
    const add = await req(d, 'POST', '/workspaces', { cwd: WS.C });
    log(phase, 'C', 'addWorkspace', add.status);
    log(phase, 'C', 'trustedAtAdd', await trustedC());
    setTrust('DO_NOT_TRUST');
    log(phase, 'C', 'untrustReplacedMs', await waitTrust(false));
    const u = await req(d, 'POST', '/session', { cwd: WS.C });
    const uf = u.status === 200 ? [...findTranscript(RT.C, u.json.sessionId), ...findTranscript(QDIR, u.json.sessionId)][0] : undefined;
    log(phase, 'C-untrusted', 'create', { status: u.status, code: u.json?.code ?? null, transcript: uf ? records(uf).map(shape) : 'absent', where: uf ? path.dirname(uf).replace(OUT, '$OUT') : null });
    log(phase, 'C-untrusted', 'engines', await stopEngines(d, WS.C));
    if (u.status === 200) await req(d, 'DELETE', `/session/${u.json.sessionId}`);
    setTrust('TRUST_FOLDER');
    log(phase, 'C', 'retrustReplacedMs', await waitTrust(true));
    const ld = await req(d, 'POST', `/session/${state.c.id}/load`, { cwd: WS.C });
    log(phase, 'C-retrusted', 'loadP1Session', ld.status === 200 ? 200 : `${ld.status} ${ld.json?.code ?? ''}`);
    log(phase, 'C-retrusted', 'engines', await stopEngines(d, WS.C));
    if (ld.status === 200) await req(d, 'DELETE', `/session/${state.c.id}`);
    const n = await req(d, 'POST', '/session', { cwd: WS.C });
    const nf = n.status === 200 ? findTranscript(RT.C, n.json.sessionId)[0] : undefined;
    log(phase, 'C-retrusted', 'create', { status: n.status, transcript: nf ? records(nf).map(shape) : 'absent' });
    if (n.status === 200) await req(d, 'DELETE', `/session/${n.json.sessionId}`);
    const m = await req(d, 'POST', `/session/${state.mc.id}/load`, { cwd: WS.C });
    log(phase, 'C-retrusted', 'managedLoad', `${m.status} ${m.json?.code ?? ''}`);
  } finally {
    await stop(d, phase);
  }
}

async function phaseFlagOnBase(phase) {
  const { exit, output } = await startDaemon(phase, { paired: true, workspaces: ['A'], expectExit: true });
  const line = output.split('\n').find((l) => /Unknown argument|paired/i.test(l)) ?? output.trim().split('\n').at(-1);
  if (!exit) { /* unexpected: base accepted the flag */ }
  log(phase, 'flag', 'exit', { code: exit?.code ?? 'still running', line: line?.slice(0, 200) });
}


// Extra probes: a torn final line, an upper-case session id, a managed
// scratch workspace. Paired and unpaired daemons over one storage.
async function phaseExtra() {
  let d = await startDaemon('E1', { paired: true });
  const t = {};
  try {
    const c = await req(d, 'POST', '/session', { cwd: WS.A });
    t.id = c.json.sessionId;
    await req(d, 'POST', `/session/${t.id}/prompt`, { prompt: [{ type: 'text', text: 'hello torn' }] });
    let f; const t0 = Date.now();
    while (!f && Date.now() - t0 < 30_000) { await sleep(250); f = findTranscript(RT.A, t.id)[0]; }
    await waitTurn(f);
    t.file = f;
    await req(d, 'DELETE', `/session/${t.id}`);
    // upper-case spelling of a Legacy session and of a Managed-owned one
    const up = await req(d, 'POST', `/session/${t.id.toUpperCase()}/load`, { cwd: WS.A });
    log('E1', 'upper', 'legacyLoad', `${up.status} ${up.json?.code ?? ''} ${up.json?.sessionId ? (up.json.sessionId === t.id ? 'id=canonical' : 'id=' + up.json.sessionId.slice(0, 8)) : ''}`);
    if (up.status === 200) await req(d, 'DELETE', `/session/${up.json.sessionId}`);
    const m = plantManaged({ file: f }, 'A');
    t.m = m;
    const upm = await req(d, 'POST', `/session/${m.id.toUpperCase()}/load`, { cwd: WS.A });
    log('E1', 'upper', 'managedLoad', `${upm.status} ${upm.json?.code ?? ''}`);
    if (upm.status === 200) await req(d, 'DELETE', `/session/${upm.json.sessionId}`);
    // torn final line, as a crash in the middle of an append leaves it
    const good = fs.readFileSync(f, 'utf8');
    const last = good.trimEnd().split('\n').at(-1);
    fs.writeFileSync(f, good + last.slice(0, Math.floor(last.length / 2)));
    t.tornSha = sha(f);
    const tl = await req(d, 'POST', `/session/${t.id}/load`, { cwd: WS.A });
    log('E1', 'torn', 'pairedLoad', `${tl.status} ${tl.json?.code ?? ''} | ${String(tl.json?.error ?? '').slice(0, 150)}`);
    log('E1', 'torn', 'bytes', sha(f) === t.tornSha ? 'unchanged' : 'CHANGED');
    if (tl.status === 200) await req(d, 'DELETE', `/session/${t.id}`);
    // managed scratch workspace (dynamic factory, managed-scratch provenance)
    const sc = await req(d, 'POST', '/workspaces', { kind: 'scratch' });
    log('E1', 'scratch', 'add', `${sc.status} ${JSON.stringify(sc.json).slice(0, 160)}`);
  } finally { await stop(d, 'E1'); }
  d = await startDaemon('E2', { paired: false });
  try {
    const tl = await req(d, 'POST', `/session/${t.id}/load`, { cwd: WS.A });
    log('E2', 'torn', 'unpairedLoad', `${tl.status} ${tl.json?.code ?? ''}`);
    if (tl.status === 200) {
      await req(d, 'POST', `/session/${t.id}/prompt`, { prompt: [{ type: 'text', text: 'after torn' }] });
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) { if (records2(t.file).filter((r) => r.type === 'assistant').length >= 2) break; await sleep(300); }
      log('E2', 'torn', 'unpairedAppended', { assistants: records2(t.file).filter((r) => r.type === 'assistant').length, tornLineStillInside: fs.readFileSync(t.file, 'utf8').split('\n').some((l) => { try { JSON.parse(l); return false; } catch { return l.length > 0; } }) });
      await req(d, 'DELETE', `/session/${t.id}`);
    }
  } finally { await stop(d, 'E2'); }
  d = await startDaemon('E3', { paired: true });
  try {
    const tl = await req(d, 'POST', `/session/${t.id}/load`, { cwd: WS.A });
    log('E3', 'torn', 'pairedLoadAfterUnpairedAppend', `${tl.status} ${tl.json?.code ?? ''} | ${String(tl.json?.error ?? '').slice(0, 150)}`);
  } finally { await stop(d, 'E3'); }
}
// tolerant reader for a transcript that may hold a torn line
const records2 = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

try {
  if (PLAN === 'extra') {
    await phaseExtra();
  } else if (PLAN === 'head') {
    await phaseMain('P1', true);
    await phaseReplacement('P1R');
    await phaseRestore('P2', false, [['A-paired', state.a], ['A-ownerOnly', { id: state.ownerOnly, cwd: WS.A, wsKey: 'A' }], ['B-paired', state.b], ['A-managed', state.ma]]);
    await phaseRestore('P3', true, [['U-unpaired', state.u], ['A-paired', state.a]]);
    await phaseFirstRequest('P4');
    await phaseHosted('P5', true);
    await phaseHosted('P5', false);
  } else if (PLAN === 'p1') {
    await phaseMain('P1', true);
    await phaseReplacement('P1R');
  } else {
    await phaseMain('P1', false);
    if (PLAN === 'base') await phaseFlagOnBase('P6');
  }
} catch (e) {
  console.error('RIG ERROR', e?.stack ?? e);
  log('rig', 'error', 'message', String(e?.message ?? e).slice(0, 2000));
  process.exitCode = 1;
} finally {
  await model.close();
  fs.writeFileSync(path.join(OUT, 'model-requests.json'), JSON.stringify(model.requests, null, 2));
}
