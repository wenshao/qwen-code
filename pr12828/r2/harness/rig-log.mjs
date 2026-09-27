// Round 2 (26c51b351a): does the daemon log say why a restore was refused,
// and how long does the paired owner read take on a large transcript?
// ARMS=name:wt:paired[:extraArgs],... ; every arm reads the same storage.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startFakeModel } from './fake-model.mjs';

const OUT = path.resolve(process.env.OUT);
const BIG_MB = Number(process.env.BIG_MB ?? 100);
fs.rmSync(OUT, { recursive: true, force: true });
const HOME = path.join(OUT, 'home');
const QDIR = path.join(HOME, '.qwen');
fs.mkdirSync(QDIR, { recursive: true });
fs.mkdirSync(path.join(OUT, 'ws/alpha'), { recursive: true });
const WS = fs.realpathSync(path.join(OUT, 'ws/alpha'));
fs.writeFileSync(path.join(QDIR, 'settings.json'), JSON.stringify({
  security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: true } },
  model: { name: 'fake-model' }, general: { enableAutoUpdate: false }, tools: { approvalMode: 'yolo' },
}, null, 2));
fs.writeFileSync(path.join(QDIR, 'trustedFolders.json'), JSON.stringify({ [WS]: 'TRUST_FOLDER' }));
const model = await startFakeModel('fake-model');
const env = { PATH: process.env.PATH, HOME, TMPDIR: process.env.TMPDIR, OPENAI_API_KEY: 'k', OPENAI_BASE_URL: model.url, OPENAI_MODEL: 'fake-model', NO_PROXY: '*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
const out = [];
const note = (...a) => { const l = a.join(' '); out.push(l); console.log(l); };

async function daemon(wt, paired, extra = []) {
  const port = await freePort();
  const logFile = path.join(OUT, `d-${port}.log`);
  const fd = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, [path.join(wt, 'dist/cli.js'), 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', WS, ...(paired ? ['--experimental-paired-engines'] : []), ...extra], { cwd: WS, env, stdio: ['ignore', fd, fd] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/capabilities`)).status === 200) break; } catch {} await sleep(200); }
  const req = async (method, url, body) => {
    for (let i = 0; ; i++) {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 && j.code === 'daemon_runtime_starting' && i < 100) { await sleep(300); continue; }
      return { status: r.status, json: j };
    }
  };
  return { req, logFile, stop: async () => { child.kill('SIGTERM'); await new Promise((r) => child.on('exit', r)); } };
}
const daemonLog = () => { const f = path.join(QDIR, 'debug/daemon/daemon.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };

// seed one prompted Legacy session with a paired daemon of the first arm
const arms = process.env.ARMS.split(',').map((a) => { const [name, wt, paired, ...x] = a.split(':'); return { name, wt, paired: paired === '1', extra: x.join(':') ? x.join(':').split(' ') : [] }; });
let d = await daemon(arms[0].wt, true);
const c = await d.req('POST', '/session', { cwd: WS, sessionScope: 'thread' });
const id = c.json.sessionId;
await d.req('POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text: 'seed turn' }] });
const chats = () => path.join(QDIR, 'projects', fs.readdirSync(path.join(QDIR, 'projects')).find((p) => p.includes('alpha')), 'chats');
for (let i = 0; i < 300; i++) { const f = path.join(chats(), `${id}.jsonl`); if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('"type":"assistant"')) break; await sleep(200); }
await sleep(1500);
await d.req('DELETE', `/session/${id}`);
await d.stop();
const src = fs.readFileSync(path.join(chats(), `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const variants = {};
const write = (label, recs, tail = '') => {
  const nid = crypto.randomUUID();
  const lines = recs.map((r) => JSON.stringify({ ...r, sessionId: nid }));
  const f = path.join(chats(), `${nid}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n' + tail);
  variants[label] = { id: nid, file: f, sha: sha(f), mb: (fs.statSync(f).size / 1e6).toFixed(1) };
};
const ownerIdx = src.findIndex((r) => r.subtype === 'session_execution_engine');
const last = JSON.stringify(src.at(-1));
write('torn last line', src, last.slice(0, Math.floor(last.length / 2)));
write('unknown record subtype', [...src, { ...src.at(-1), uuid: crypto.randomUUID(), parentUuid: src.at(-1).uuid, type: 'system', subtype: 'future_record_v9', systemPayload: {} }]);
write('Managed owner', src.map((r, i) => (i === ownerIdx ? { ...r, systemPayload: { version: 1, engine: 'managed' } } : r)));
{
  const m = src.map((r, i) => (i === ownerIdx ? { ...r, systemPayload: { version: 1, engine: 'managed' } } : r));
  const [o] = m.splice(ownerIdx, 1);
  m.splice(1, 0, o);
  write('Managed owner not first', m);
}
{
  // a large Legacy transcript: the seed turn repeated with fresh, chained uuids
  const turn = src.filter((r) => r.type === 'user' || r.type === 'assistant');
  const pad = 'x'.repeat(4000);
  const recs = [src[ownerIdx]];
  let prev = src[ownerIdx].uuid;
  const target = BIG_MB * 1e6;
  let size = 0;
  while (size < target) {
    for (const r of turn) {
      const u = crypto.randomUUID();
      const rec = { ...r, uuid: u, parentUuid: prev, ...(r.type === 'user' ? { message: { role: 'user', parts: [{ text: `big ${pad}` }] } } : {}) };
      prev = u;
      recs.push(rec);
      size += JSON.stringify(rec).length + 1;
    }
  }
  write(`Legacy ${BIG_MB} MB`, recs);
}
note(`variants: ${Object.entries(variants).map(([k, v]) => `${k}=${v.mb}MB`).join(', ')}`);

for (const arm of arms) {
  d = await daemon(arm.wt, arm.paired, arm.extra);
  note(`== ${arm.name}${arm.paired ? ' (paired)' : ''} ${arm.extra.join(' ')}`);
  for (const [label, v] of Object.entries(variants)) {
    if (arm.only && !arm.only.includes(label)) continue;
    const before = daemonLog().length;
    const t0 = Date.now();
    const r = await d.req('POST', `/session/${v.id}/load`, { cwd: WS });
    const ms = Date.now() - t0;
    await sleep(300);
    const added = daemonLog().slice(before).split('\n').filter((l) => l.includes(v.id) && /WARN|ERROR/.test(l) && /execution engine|Session execution|belongs|incomplete|invalid|owner/i.test(l));
    const why = added.map((l) => l.replace(/^.*?\[DAEMON\] (runId=\S+ pid=\d+ )?/, '').replace(v.id, '<id>').slice(0, 170));
    note(`  ${label.padEnd(24)} ${r.status} ${(r.json.code ?? '').padEnd(36)} ${String(ms).padStart(6)}ms bytes ${sha(v.file) === v.sha ? 'same' : 'CHANGED'} | log: ${why.length ? why.join(' / ') : '(nothing)'}`);
    if (r.status === 200) await d.req('DELETE', `/session/${v.id}`);
  }
  await d.stop();
}
fs.writeFileSync(path.join(OUT, 'rows.txt'), out.join('\n') + '\n');
await model.close();
