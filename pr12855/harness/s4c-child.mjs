// Writer A for s4c: commits two revisions, then a third whose response the
// proxy drops, then the process dies without closing (a crash).
import http from 'node:http';
import fs from 'node:fs';
import { FIXTURES, PORT, RefMapper, commitMonitor, openSession } from './lib.mjs';
const [sessionId, out] = process.argv.slice(2);
let dropNext = false;
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const up = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, (ur) => {
      const o = [];
      ur.on('data', (c) => o.push(c));
      ur.on('end', () => {
        if (dropNext && req.url.includes('/transactions:commit')) { dropNext = false; req.socket.destroy(); return; }
        res.writeHead(ur.statusCode, ur.headers); res.end(Buffer.concat(o));
      });
    });
    up.end(Buffer.concat(chunks));
  });
});
await new Promise((r) => proxy.listen(18957, '127.0.0.1', r));
const a = await openSession({ sessionId, writerId: 'crash-a', create: true, port: 18957 });
const refs = new RefMapper(a.session.resources);
const bodies = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
await commitMonitor(a.session, a.sessionKey, 'monitor-1:1', bodies[0]);
await commitMonitor(a.session, a.sessionKey, 'monitor-1:2', bodies[1]);
dropNext = true;
let err;
try { await commitMonitor(a.session, a.sessionKey, 'monitor-1:3', bodies[2]); } catch (e) { err = `${e.name}: ${String(e.message).slice(0, 90)}`; }
const refMap = {};
for (const [k, p] of refs.map) refMap[k] = await p;
fs.writeFileSync(out, JSON.stringify({ err, refMap, diedAt: Date.now() }));
process.exit(0); // crash: no close, no seal
