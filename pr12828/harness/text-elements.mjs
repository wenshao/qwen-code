// A/B for 45f09d5c61 ("let paired hosts restore sessions with text elements").
// 1. A raw ACP client drives a real `qwen --acp` child (WRITER_WT): new
//    session, one prompt, then the ext method qwen/session/recordTextElements,
//    so the CLI itself writes the user_text_elements record.
// 2. Each arm's bundled daemon (ARMS=name:wt:paired,...) cold-loads it.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { startFakeModel } from './fake-model.mjs';

const OUT = path.resolve(process.env.OUT);
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

// 1. write the session through a real ACP child
const child = spawn(process.execPath, [path.join(process.env.WRITER_WT, 'dist/cli.js'), '--acp'], { cwd: WS, env, stdio: ['pipe', 'pipe', 'inherit'] });
let seq = 0;
const pending = new Map();
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && !msg.method && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method && msg.id !== undefined) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
});
const call = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const init = await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
console.log('initialize', init.error ? JSON.stringify(init.error) : 'ok');
const created = await call('session/new', { cwd: WS, mcpServers: [] });
const sessionId = created.result?.sessionId;
console.log('session/new', sessionId ?? JSON.stringify(created.error));
const prompted = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'look at [Pasted text #1]' }] });
console.log('session/prompt', prompted.error ? JSON.stringify(prompted.error) : prompted.result?.stopReason);
const rec = await call(process.env.EXT_NAME ?? 'qwen/session/recordTextElements', { sessionId, content: 'look at [Pasted text #1]', textElements: [{ type: 'pasted_text', placeholder: '[Pasted text #1]', text: 'hello' }] });
console.log('recordTextElements', rec.error ? JSON.stringify(rec.error) : JSON.stringify(rec.result));
child.kill('SIGTERM');
await new Promise((r) => child.on('exit', r));
const chats = path.join(QDIR, 'projects', fs.readdirSync(path.join(QDIR, 'projects')).find((p) => p.includes('alpha')), 'chats');
const file = path.join(chats, `${sessionId}.jsonl`);
const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log('records', recs.map((r) => r.subtype ?? r.type).join(', '));

// 2. cold-load it on each arm
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
for (const arm of process.env.ARMS.split(',')) {
  const [name, wt, paired] = arm.split(':');
  const port = await freePort();
  const d = spawn(process.execPath, [path.join(wt, 'dist/cli.js'), 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', WS, ...(paired === '1' ? ['--experimental-paired-engines'] : [])], { cwd: WS, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/capabilities`)).status === 200) break; } catch {} await sleep(200); }
  let r, j;
  for (let i = 0; i < 100; i++) {
    r = await fetch(`${base}/session/${sessionId}/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: WS }) });
    j = await r.json().catch(() => ({}));
    if (!(r.status === 503 && j.code === 'daemon_runtime_starting')) break;
    await sleep(300);
  }
  console.log(`load on ${name}${paired === '1' ? ' (paired)' : ''}:`, r.status, j.code ?? '');
  d.kill('SIGTERM');
  await new Promise((res) => d.on('exit', res));
}
await model.close();
