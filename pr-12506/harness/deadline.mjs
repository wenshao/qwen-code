// New head a92a8fe: boot stdin must close within 30 s.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const ENTRY = process.argv[2];
const valid = readFileSync('boot.json', 'utf8');
async function run(name, feed) {
  const t0 = Date.now();
  const c = spawn('/usr/bin/strace', ['-f', '-qq', '-e', 'trace=listen', '-o', `/tmp/claude-dl-${name.replace(/\W/g, '')}.log`, process.execPath, ENTRY, 'managed-runtime-worker'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  c.stdin.on('error', () => {});
  const stop = feed(c);
  const ex = await new Promise((r) => { c.once('exit', (code, sig) => r({ code, sig })); setTimeout(() => { c.kill('SIGKILL'); r('KILLED@60s'); }, 60000); });
  stop?.();
  const listens = (readFileSync(`/tmp/claude-dl-${name.replace(/\W/g, '')}.log`, 'utf8').match(/listen\(/g) || []).length;
  console.log(JSON.stringify({ case: name, exitAfterS: ((Date.now() - t0) / 1000).toFixed(1), exit: ex, stdout: out, listen: listens, stderr: err.trim().split('\n').slice(0, 2).join(' | ') }));
}
await run('full doc written, stdin never closed', (c) => { c.stdin.write(valid); });
await run('nothing written, stdin never closed', () => {});
await run('trickle 1 byte/s, never closed', (c) => { let i = 0; const t = setInterval(() => { if (i < valid.length) c.stdin.write(valid[i++]); }, 1000); return () => clearInterval(t); });
await run('doc written at 25 s then closed', (c) => { const t = setTimeout(() => c.stdin.end(valid), 25000); return () => clearTimeout(t); });
