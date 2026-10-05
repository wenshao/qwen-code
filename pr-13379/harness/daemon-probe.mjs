// Boot `qwen serve` for one arm against the rich fixture, hit the extension routes, dump JSON.
// usage: node daemon-probe.mjs <arm> <home> <outdir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [arm, home, outdir] = process.argv.slice(2);
const ws = '/root/verify/pr13379/ws';
const env = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'dumb' };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'QWEN_HOME', 'QWEN_RUNTIME_DIR']) delete env[k];
const child = spawn('node', [`/root/verify/pr13379/${arm}/dist/cli.js`, 'serve', '--port', '0', '--token', 'T0K', '--workspace', ws], { cwd: ws, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const base = await new Promise((resolve, reject) => {
  const onData = (d) => { log += d; const m = /listening on (http:\/\/[^\s]+)/.exec(log); if (m) resolve(m[1].replace(/\/$/, '')); };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  setTimeout(() => reject(new Error('daemon did not start:\n' + log)), 60000);
});
const get = async (p) => { const r = await fetch(base + p, { headers: { authorization: 'Bearer T0K' } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const out = {};
for (const p of ['/workspace/extensions', '/workspace/extensions/summary', '/extensions',
  '/workspace/extensions/dupe/details', '/workspace/extensions/linked-ext/details',
  '/workspace/extensions/portable-plugin/details', '/workspace/extensions/heavy/details',
  '/workspace/extensions/no-such-ext/details']) out[p] = await get(p);
// 24 concurrent catalog/detail/status reads against the same daemon
const conc = await Promise.all(Array.from({ length: 24 }, (_, i) =>
  get(['/workspace/extensions/summary', '/workspace/extensions/dupe/details', '/extensions', '/workspace/extensions'][i % 4])));
out.concurrent = conc.map((r) => r.status);
out.concurrentConsistent = conc.every((r, i) => JSON.stringify(r.body) === JSON.stringify(conc[i % 4].body));
fs.writeFileSync(`${outdir}/daemon-${arm}.json`, JSON.stringify(out, null, 1));
child.kill('SIGTERM');
console.log(arm, base, Object.entries(out).filter(([k]) => k.startsWith('/')).map(([k, v]) => `${k}=${v.status}`).join(' '), 'concurrent', [...new Set(out.concurrent)], out.concurrentConsistent);
process.exit(0);
