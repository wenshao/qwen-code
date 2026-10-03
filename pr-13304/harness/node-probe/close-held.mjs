import http from 'node:http';
import net from 'node:net';
const variant = process.argv[2] ?? 'publisher-like';
const server = http.createServer((req, res) => {
  // Mimic a body parser that waits for the whole body.
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => res.end('ok'));
});
if (variant !== 'defaults') {
  server.headersTimeout = 5_000;
  server.requestTimeout = 30_000;
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const socket = net.connect(port, '127.0.0.1');
await new Promise((r) => socket.once('connect', r));
let reply = '';
const t0 = Date.now();
socket.on('data', (d) => (reply += d));
socket.on('close', () => {
  console.log(`[${variant}] held socket closed at ${Date.now() - t0}ms reply=${JSON.stringify(reply.split('\r\n')[0])}`);
});
socket.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 64\r\n\r\n{`);
await new Promise((r) => setTimeout(r, 200));
let state = 'pending';
server.close((e) => (state = e ? 'error ' + e.code : 'closed'));
const tick = setInterval(() => console.log(`[${variant}] t=${Date.now() - t0}ms server.close ${state}`), 2_000);
setTimeout(() => { clearInterval(tick); socket.destroy(); setTimeout(() => { console.log(`[${variant}] end state ${state}`); process.exit(0); }, 100); }, 70_000);
