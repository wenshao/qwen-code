// Does Node's fetch put the request on the wire before a synchronous execSync that follows it?
const { spawn, execSync } = require('node:child_process');
const srv = spawn(process.execPath, ['-e', `
const http=require('http');
const s=http.createServer((q,r)=>{process.stdout.write(JSON.stringify({ev:'srv_recv',url:q.url,t:Date.now()})+'\\n');r.end('ok')});
s.keepAliveTimeout=60000; s.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:s.address().port})+'\\n'));`], { stdio: ['ignore', 'pipe', 'inherit'] });
let buf = '';
srv.stdout.on('data', async (d) => {
  buf += d;
  const lines = buf.split('\n'); buf = lines.pop();
  for (const l of lines) {
    const m = JSON.parse(l);
    if (m.port) run(m.port);
    else console.log(m);
  }
});
async function run(port) {
  const base = `http://127.0.0.1:${port}`;
  await (await fetch(base + '/warm')).text(); // keep-alive socket in the pool, like createOrAttachSession
  for (const warm of [true, false]) {
    const p = fetch(base + (warm ? '/pooled' : '/x'), warm ? {} : {});
    const t0 = Date.now();
    console.log({ ev: 'fetch_called', t: t0 });
    execSync('sleep 0.3');
    console.log({ ev: 'execSync_returned', t: Date.now() });
    await (await p).text();
    break;
  }
  setTimeout(() => { srv.kill(); process.exit(0); }, 200);
}
