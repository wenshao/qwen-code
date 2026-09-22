const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [arm] = process.argv.slice(2);
const c = spawn('/root/verify/h12267r6/q.sh', [arm, 'ww-closed', 'sandbox', '--', 'sh', '-c', 'readlink /proc/self/fd/0; cat | wc -c'], { stdio: ['pipe', 'pipe', 'ignore'] });
let out = ''; c.stdout.on('data', (d) => (out += d));
c.stdin.end('hello-from-node-spawn\n');
c.on('close', (code) => { const st = fs.fstatSync(0); console.log(`${arm}: rc=${code} out=${JSON.stringify(out.trim())}`); });
