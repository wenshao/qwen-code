const { spawn } = require('node:child_process');
const [arm] = process.argv.slice(2);
const ART = '/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444';
const c = spawn(`${ART}/harness-r7/q.sh`, [arm, 'ww-closed', 'sandbox', '--', 'sh', '-c', 'readlink /proc/self/fd/0; cat | wc -c'], { stdio: ['pipe', 'pipe', 'ignore'] });
let out = ''; c.stdout.on('data', (d) => (out += d));
c.stdin.end('hello-from-node-spawn\n');
c.on('close', (code) => { console.log(`${arm}: rc=${code} out=${JSON.stringify(out.trim())}`); });
