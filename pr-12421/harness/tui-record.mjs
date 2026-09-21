// Record a real TUI session (node-pty) to a timestamped raw log.
// Usage: node tui-record.mjs <arm> <mode: real|mock> <cols> <rows>
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire('/root/verify/pr12421-head/package.json');
const pty = require('@lydell/node-pty');
const [arm, mode, cols = '112', rows = '46'] = process.argv.slice(2);
const H = '/root/verify/pr12421-harness';
const home = `${H}/home-tui-${arm}-${mode}`;
fs.rmSync(home, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
const key = execSync(`jq -r .env.CLIPROXY_API_KEY ${process.env.HOME}/.qwen/settings.json`).toString().trim();
const baseUrl = mode === 'real' ? '<GPT_PROXY_BASE_URL>' : 'http://127.0.0.1:18795/v1';
const model = mode === 'real' ? 'gpt-5.6-luna' : 'mock-model';
const env = { PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1', NODE_NO_WARNINGS: '1', LANG: 'en_US.UTF-8',
  QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', QWEN_CODE_SUPPRESS_YOLO_WARNING: '1', OPENAI_API_KEY: mode === 'real' ? key : 'dummy' };
const p = pty.spawn('node', [`/root/verify/pr12421-arms/${arm}/cli.js`, '--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-base-url', baseUrl, '--model', model],
  { name: 'xterm-256color', cols: Number(cols), rows: Number(rows), cwd: `${H}/ws`, env });
const t0 = Date.now(); const chunks = []; let raw = '';
p.onData((d) => { chunks.push([Date.now() - t0, d]); raw += d; });
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(re, timeout) { const s = Date.now(); while (Date.now() - s < timeout) { if (re.test(strip(raw))) return true; await sleep(200); } return false; }
async function idle(stable, timeout) { const s = Date.now(); let n = raw.length, last = Date.now(); while (Date.now() - s < timeout) { await sleep(100); if (raw.length !== n) { n = raw.length; last = Date.now(); } else if (Date.now() - last >= stable) return; } }
if (!(await waitFor(/Type your message/i, 90000))) { console.log('no prompt'); }
await idle(1500, 15000);
const prompt = mode === 'real' ? 'Read the Jupyter notebook at /root/verify/pr12421-harness/ws/example.ipynb and tell me exactly what its code cell prints. Use only the read_file tool.' : 'hi';
p.write(prompt); await idle(400, 4000); const tSubmit = Date.now() - t0; p.write('\r');
if (mode === 'mock') await idle(3000, 30000);
else {
  const s = Date.now();
  while (Date.now() - s < 300000) {
    await sleep(1000);
    const txt = strip(raw.slice(-20000));
    if (arm === 'pr' && /42/.test(txt) && raw.length > 0) { await idle(5000, 30000); break; }
    if (arm === 'base' && /Loop detection|loop was detected|repeated the same tool call|could(?:n.t| not) read/i.test(txt)) { await idle(4000, 20000); break; }
  }
}
fs.writeFileSync(`${H}/shots/raw-${arm}-${mode}.json`, JSON.stringify({ cols: Number(cols), rows: Number(rows), tSubmit, chunks }));
console.log(`recorded ${arm} ${mode}: ${chunks.length} chunks, ${Math.round((Date.now() - t0) / 1000)}s`);
p.kill(); process.exit(0);
