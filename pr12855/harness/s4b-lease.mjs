// S4b: after an unknown-outcome commit, what does writer A keep sending, and
// when can writer B take over? A talks through a logging proxy.
import http from 'node:http';
import { FIXTURES, PORT, RefMapper, commitMonitor, createPublicSession, openLog, openSession, say, sleep } from './lib.mjs';
openLog('s4b-lease');
const log = [];
const t0 = Date.now();
let dropNext = false;
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const up = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, (ur) => {
      const out = [];
      ur.on('data', (c) => out.push(c));
      ur.on('end', () => {
        const name = req.url.split('?')[0].split('/').pop();
        log.push({ s: ((Date.now() - t0) / 1000).toFixed(1), name, status: ur.statusCode });
        if (dropNext && name === 'transactions:commit') { dropNext = false; req.socket.destroy(); return; }
        res.writeHead(ur.statusCode, ur.headers);
        res.end(Buffer.concat(out));
      });
    });
    up.end(Buffer.concat(chunks));
  });
});
await new Promise((r) => proxy.listen(18956, '127.0.0.1', r));
const pub = await createPublicSession({ actor: 'alice' });
const a = await openSession({ sessionId: pub.id, writerId: 'lease-a', create: true, port: 18956 });
const refs = new RefMapper(a.session.resources);
const b0 = await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun);
await commitMonitor(a.session, a.sessionKey, 'm:1', b0);
dropNext = true;
const dropAt = (Date.now() - t0) / 1000;
await commitMonitor(a.session, a.sessionKey, 'm:2', { ...b0, run: { ...b0.run } }).catch(() => {});
const mode = process.env.MODE ?? 'close';
let closeErr = null;
if (mode === 'close') await a.session.close().catch((e) => (closeErr = String(e.message).slice(0, 100)));
let b, tries = 0, openedAt = null, lastErr;
while (!b && (Date.now() - t0) / 1000 < dropAt + 150) {
  tries++;
  try { b = await openSession({ sessionId: pub.id, writerId: 'lease-b' }); openedAt = ((Date.now() - t0) / 1000 - dropAt).toFixed(1); }
  catch (e) { lastErr = String(e.message).slice(0, 90); await sleep(5000); }
}
const afterDrop = log.filter((l) => Number(l.s) > dropAt);
say(`lease-${mode}`, {
  closeErr,
  bOpenedSecondsAfterDrop: openedAt,
  bTries: tries,
  lastErr,
  requestsFromAAfterDrop: afterDrop.map((l) => `${l.s}s ${l.name} ${l.status}`),
});
if (b) await b.session.close();
proxy.close();
process.exit(0);
