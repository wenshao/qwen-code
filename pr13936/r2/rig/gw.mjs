// Trusted product gateway stand-in for the PR 13936 rig: browser (Vite proxy) -> gw -> Spring.
// - injects the trusted actor header (x-rig-actor) the way a product BFF adds identity;
// - logs every Web Shell task/operation request + response body to runs/<db>/gw.jsonl;
// - control port: /arm?drop=<substr> drops the reply of the next matching POST AFTER Spring
//   answered (server committed, browser never sees the reply); /armed, /disarm.
// usage: node gw.mjs <listenPort> <springPort> <ctlPort> <logFile> [actor]
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const [, , LP, SP, CP, LOG, ACTOR = 'rig-actor'] = process.argv;
let drop = null;
const delays = new Map(); // path substring -> ms (response delay, persists until /nodelay)
// path substring -> ms, applied only to replies that carry no terminal task state (a stale replica:
// nonterminal snapshots arrive late, terminal ones immediately) — persists until /nodelay
const staleDelays = new Map();
const TERMINAL = /"state":"(completed|failed|cancelled)"/;
// path substring -> HTTP status: answer without forwarding (a read outage) — persists until /nodelay
const fails = new Map();
let dropped = 0;
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const interesting = (u) => /\/tasks\/|\/operations\/|\/sessions\/(get|cancel)/.test(u);

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers, host: `127.0.0.1:${SP}` };
      if (ACTOR !== '-') headers['x-rig-actor'] = ACTOR;
      delete headers['content-length'];
      if (body.length) headers['content-length'] = String(body.length);
      const failStatus = [...fails].find(([k]) => req.url.includes(k))?.[1];
      if (failStatus) {
        res.writeHead(failStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'rig_unavailable', message: 'rig outage' } }));
        return;
      }
      const shouldDrop = drop && req.method === 'POST' && req.url.includes(drop);
      if (shouldDrop) drop = null;
      const up = http.request({ host: '127.0.0.1', port: SP, method: req.method, path: req.url, headers }, (ur) => {
        const sse = String(ur.headers['content-type'] ?? '').includes('text/event-stream');
        if (sse) {
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
          ur.on('aborted', () => res.destroy());
          ur.on('close', () => res.destroy());
          res.on('close', () => ur.destroy());
          return;
        }
        const rc = [];
        ur.on('data', (c) => rc.push(c));
        ur.on('end', () => {
          const rb = Buffer.concat(rc);
          if (interesting(req.url) || shouldDrop)
            log({ m: req.method, u: req.url, req: body.toString('utf8').slice(0, 2000), s: ur.statusCode, res: rb.toString('utf8').slice(0, 3000), dropped: !!shouldDrop });
          const staleMs = TERMINAL.test(rb.toString('utf8')) ? 0 : ([...staleDelays].find(([k]) => req.url.includes(k))?.[1] ?? 0);
          const delayMs = ([...delays].find(([k]) => req.url.includes(k))?.[1] ?? 0) || staleMs;
          if (delayMs && !shouldDrop) {
            setTimeout(() => { res.writeHead(ur.statusCode, ur.headers); res.end(rb); }, delayMs);
            return;
          }
          if (shouldDrop) {
            dropped++;
            req.socket.destroy();
            return;
          }
          res.writeHead(ur.statusCode, ur.headers);
          res.end(rb);
        });
      });
      up.on('error', (e) => {
        log({ m: req.method, u: req.url, upstreamError: String(e) });
        res.destroy();
      });
      res.on('close', () => { if (!res.writableEnded) up.destroy(); });
      up.end(body);
    });
  })
  .listen(Number(LP), '127.0.0.1', () => console.log(`GW ${LP} -> ${SP} actor=${ACTOR}`));

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/arm') drop = u.searchParams.get('drop');
    if (u.pathname === '/disarm') drop = null;
    if (u.pathname === '/delay') delays.set(u.searchParams.get('path'), Number(u.searchParams.get('ms')));
    if (u.pathname === '/stale') staleDelays.set(u.searchParams.get('path'), Number(u.searchParams.get('ms')));
    if (u.pathname === '/fail') fails.set(u.searchParams.get('path'), Number(u.searchParams.get('status')));
    if (u.pathname === '/nodelay') { delays.clear(); staleDelays.clear(); fails.clear(); }
    res.end(JSON.stringify({ drop, dropped, delays: [...delays], stale: [...staleDelays], fails: [...fails] }) + '\n');
  })
  .listen(Number(CP), '127.0.0.1');
