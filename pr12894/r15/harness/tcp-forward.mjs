// VERIFICATION RIG ONLY (PR #12894): raw TCP forwarder in front of real Aliyun OSS.
// The JVM resolves the bucket host to 127.0.0.1 (-Djdk.net.hosts.file); this relays the
// TLS bytes unchanged to TARGET (the real OSS address), so certificates still validate.
// Control 127.0.0.1:18898: POST /arm {"ms":9000,"minBytes":65536,"dir":"up"|"down"} holds
// the next chunk of at least minBytes in that direction for ms. GET /ledger.
import net from 'node:net';
import http from 'node:http';

const TARGET = process.env.TARGET; // ip:port
const [thost, tport] = TARGET.split(':');
const armed = [];
const ledger = [];
const log = (e) => { ledger.push({ t: Date.now(), ...e }); if (ledger.length > 5000) ledger.splice(0, 1000); };
const take = (dir, n) => {
  const i = armed.findIndex((a) => a.dir === dir && n >= (a.minBytes ?? 65536));
  return i < 0 ? null : armed.splice(i, 1)[0];
};
const pipe = (from, to, dir, id) => {
  from.on('data', (chunk) => {
    const a = take(dir, chunk.length);
    if (!a) return void to.write(chunk);
    from.pause();
    log({ hold: dir, conn: id, bytes: chunk.length, ms: a.ms });
    setTimeout(() => { to.write(chunk); from.resume(); }, a.ms);
  });
  from.on('end', () => to.end());
  from.on('error', () => to.destroy());
};
let n = 0;
net.createServer((client) => {
  // Bound on the wildcard (macOS lets an unprivileged process take :443 only there); loopback clients only.
  if (!/^(127\.0\.0\.1|::ffff:127\.0\.0\.1|::1)$/.test(client.remoteAddress ?? '')) { log({ refused: client.remoteAddress }); return void client.destroy(); }
  const id = ++n;
  const upstream = net.connect(Number(tport), thost, () => log({ conn: id, open: TARGET }));
  pipe(client, upstream, 'up', id);
  pipe(upstream, client, 'down', id);
  upstream.on('error', (e) => { log({ conn: id, error: e.message }); client.destroy(); });
  client.on('error', () => upstream.destroy());
}).listen(443, '0.0.0.0', () => console.log(`tcp forward :443 (loopback clients only) -> ${TARGET}`));
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (req.url === '/arm') { armed.push({ dir: 'up', minBytes: 65536, ...body }); return send(armed); }
  if (req.url === '/clear') { armed.length = 0; return send([]); }
  if (req.url.startsWith('/ledger')) return send(ledger);
  res.writeHead(404); res.end();
}).listen(18898, '127.0.0.1', () => console.log('tcp forward control on 127.0.0.1:18898'));
