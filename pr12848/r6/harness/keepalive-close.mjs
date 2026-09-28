// Does http.Server#close() wait for an idle keep-alive socket left by global fetch (undici)?
import { createServer } from 'node:http';
const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
for (let i = 0; i < 3; i++) await (await fetch(url, { method: 'POST', body: 'x'.repeat(1000) })).json();
let open = 0; server.getConnections((e, n) => { open = n; });
await new Promise((r) => setTimeout(r, 50));
if (process.env.CONTROL) server.closeIdleConnections = () => {}; // simulate pre-19 close()
const t0 = performance.now();
await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
console.log(`node ${process.version}: keepAliveTimeout=${server.keepAliveTimeout} open-before-close=${open} close() resolved in ${(performance.now() - t0).toFixed(1)} ms`);
