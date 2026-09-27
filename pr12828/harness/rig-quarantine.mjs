// Overdue restore on a Legacy-only daemon, paired (PAIRED=1) or not.
// A SessionStart hook sleeps while a SLOW marker exists, so one session's
// load outlives --session-restore-timeout-ms and its settlement grace; the
// question is what happens to a different, healthy session on the same
// Legacy channel.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { startFakeModel } from './fake-model.mjs';

const WT = process.env.WT;
const PAIRED = process.env.PAIRED === '1';
const OUT = path.resolve(process.env.OUT);
fs.rmSync(OUT, { recursive: true, force: true });
const HOME = path.join(OUT, 'home');
const QDIR = path.join(HOME, '.qwen');
fs.mkdirSync(QDIR, { recursive: true });
fs.mkdirSync(path.join(OUT, 'ws/alpha/.qwen'), { recursive: true });
const WS = fs.realpathSync(path.join(OUT, 'ws/alpha'));
const SLOW = path.join(OUT, 'SLOW');
fs.writeFileSync(path.join(QDIR, 'settings.json'), JSON.stringify({
  security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: true } },
  model: { name: 'fake-model' }, general: { enableAutoUpdate: false }, tools: { approvalMode: 'yolo' },
}, null, 2));
fs.writeFileSync(path.join(QDIR, 'trustedFolders.json'), JSON.stringify({ [WS]: 'TRUST_FOLDER' }));
fs.writeFileSync(path.join(WS, '.qwen/settings.json'), JSON.stringify({
  hooks: { SessionStart: [{ hooks: [{ type: 'command', name: 'rig-slow-start', command: `input=$(cat); echo "$input" >> '${OUT}/hook-inputs.log'; if [ -f '${SLOW}' ] && printf '%s' "$input" | grep -q resume; then sleep 14; fi`, timeout: 60000 }] }] },
}, null, 2));
const model = await startFakeModel('fake-model');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const logFile = path.join(OUT, 'daemon.log');
const fd = fs.openSync(logFile, 'w');
const args = [path.join(WT, 'dist/cli.js'), 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', WS, '--session-restore-timeout-ms', '2000', ...(PAIRED ? ['--experimental-paired-engines'] : [])];
const child = spawn(process.execPath, args, { cwd: WS, stdio: ['ignore', fd, fd], env: { PATH: process.env.PATH, HOME, TMPDIR: process.env.TMPDIR, OPENAI_API_KEY: 'k', OPENAI_BASE_URL: model.url, OPENAI_MODEL: 'fake-model', NO_PROXY: '*' } });
const base = `http://127.0.0.1:${port}`;
const T0 = Date.now();
const t = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
const rows = [];
const note = (what, v) => { const line = `${t().padStart(6)}  ${what}: ${typeof v === 'string' ? v : JSON.stringify(v)}`; rows.push(line); console.log(line); };
async function req(method, url, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503 && j.code === 'daemon_runtime_starting' && i < 100) { await sleep(300); continue; }
    return { status: r.status, json: j };
  }
}
const chats = () => path.join(QDIR, 'projects', fs.readdirSync(path.join(QDIR, 'projects')).find((p) => p.includes('alpha')), 'chats');
async function turn(id, text) {
  const p = await req('POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text }] });
  if (p.status !== 202) return `${p.status} ${p.json.code ?? ''}`;
  const t1 = Date.now();
  for (;;) {
    const f = path.join(chats(), `${id}.jsonl`);
    const n = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('"type":"assistant"') && l.includes(text.slice(0, 12))).length : 0;
    if (n) return `202, answered in ${Date.now() - t1}ms`;
    if (Date.now() - t1 > 60_000) return '202, no answer in 60s';
    await sleep(200);
  }
}
const acp = () => { try { return execFileSync('pgrep', ['-P', String(child.pid), '-f', 'acp']).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const liveIds = async () => { const r = await req('GET', '/workspace/sessions'); return r.status === 200 ? (r.json.sessions ?? r.json).filter?.((s) => s.live ?? s.attached ?? true).map((s) => s.sessionId?.slice(0, 8)) : `HTTP ${r.status}`; };

for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/capabilities`)).status === 200) break; } catch {} await sleep(200); }
note('daemon', PAIRED ? 'paired (--experimental-paired-engines)' : 'unpaired');
const s1 = (await req('POST', '/session', { cwd: WS, sessionScope: 'thread' })).json.sessionId;
note('S1 healthy session, first turn', await turn(s1, 'first turn of S1'));
const s2 = (await req('POST', '/session', { cwd: WS, sessionScope: 'thread' })).json.sessionId;
note('S2 first turn', await turn(s2, 'first turn of S2'));
note('S2 close', (await req('DELETE', `/session/${s2}`)).status);
fs.writeFileSync(SLOW, '');
const ld0 = Date.now();
const ld = await req('POST', `/session/${s2}/load`, { cwd: WS });
note('S2 load while its SessionStart hook sleeps 14s', `${ld.status} ${ld.json.code ?? ''} after ${Date.now() - ld0}ms`);
await sleep(3500);
note('S1 prompt after S2 restore is overdue', await turn(s1, 'second turn of S1'));
const s3 = await req('POST', '/session', { cwd: WS, sessionScope: 'thread' });
note('new session S3', `${s3.status} ${s3.json.code ?? ''}`);
await sleep(3000);
const g1 = await req('GET', `/session/${s1}`);
note('S1 after 3s', `GET ${g1.status} ${g1.json.code ?? ''}${g1.json.attached !== undefined ? ' attached=' + g1.json.attached : ''}${g1.json.status ? ' status=' + g1.json.status : ''}`);
fs.rmSync(SLOW, { force: true });
await sleep(14_000);
note('after the hook finished: ACP children', acp());
note('S1 prompt again', await turn(s1, 'third turn of S1'));
const s4 = await req('POST', '/session', { cwd: WS, sessionScope: 'thread' });
note('new session S4', `${s4.status} ${s4.json.code ?? ''}`);
const lines = (fs.readFileSync(logFile, 'utf8') + fs.readFileSync(path.join(QDIR, 'debug/daemon/daemon.log'), 'utf8')).split('\n').filter((l) => /quarantin|abandoned session|drain deadline|refusing/i.test(l)).map((l) => l.replace(/^.*?qwen serve: /, 'qwen serve: ').slice(0, 220));
note('daemon lines', lines);
child.kill('SIGTERM');
await new Promise((r) => child.on('exit', r));
await model.close();
fs.writeFileSync(path.join(OUT, 'rows.txt'), rows.join('\n') + '\n');
