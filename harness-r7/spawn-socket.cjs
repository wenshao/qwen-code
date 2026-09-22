const { spawn } = require('node:child_process');
const [arm] = process.argv.slice(2);
const c = spawn('/root/verify/r7/q.sh', [arm, 'ww-closed', 'sandbox', '--', 'sh', '-c', 'echo "link=$(readlink /proc/self/fd/0)"; cat | wc -c'], { stdio: ['pipe','pipe','ignore'] });
let out=''; c.stdout.on('data',d=>out+=d);
c.stdin.end('hello-from-node-socket\n');
c.on('close',code=>console.log(`rc=${code} ${out.replace(/\n/g,' ').trim()}`));
