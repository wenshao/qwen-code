// SIGTERM right after the first 200 from /capabilities, N runs per arm.
import fs from 'node:fs'; import path from 'node:path'; import net from 'node:net';
import { spawn } from 'node:child_process';
const OUT = path.resolve('out-sigterm'); fs.rmSync(OUT, { recursive: true, force: true });
const HOME = path.join(OUT, 'home'); fs.mkdirSync(path.join(HOME, '.qwen'), { recursive: true });
const WS = path.join(OUT, 'ws'); fs.mkdirSync(WS, { recursive: true });
fs.writeFileSync(path.join(HOME, '.qwen/settings.json'), JSON.stringify({ security: { auth: { selectedType: 'openai' } }, model: { name: 'm' } }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const arms = [['base', `${process.env.HOME}/git/pr12828-base`, false], ['head-unpaired', `${process.env.HOME}/git/pr12828-head`, false], ['head-paired', `${process.env.HOME}/git/pr12828-head`, true]];
const N = Number(process.env.N ?? 6);
for (const [name, wt, paired] of arms) {
  const codes = [];
  for (let i = 0; i < N; i++) {
    const port = await freePort();
    const fd = fs.openSync(path.join(OUT, `${name}-${i}.log`), 'w');
    const c = spawn(process.execPath, [path.join(wt, 'dist/cli.js'), 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', WS, ...(paired ? ['--experimental-paired-engines'] : [])], { cwd: WS, stdio: ['ignore', fd, fd], env: { PATH: process.env.PATH, HOME, TMPDIR: process.env.TMPDIR, OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', NO_PROXY: '*' } });
    const exited = new Promise((r) => c.on('exit', (code) => r(code)));
    for (let j = 0; j < 600; j++) { try { if ((await fetch(`http://127.0.0.1:${port}/capabilities`)).status === 200) break; } catch {} await sleep(50); }
    c.kill('SIGTERM');
    const code = await exited;
    const log = fs.readFileSync(path.join(OUT, `${name}-${i}.log`), 'utf8');
    codes.push(code === 0 ? '0' : `${code}${/ACP child process shutdown failed/.test(log) ? '(shutdown failed)' : ''}`);
  }
  console.log(name.padEnd(14), codes.join(' '));
}
