// Spring -> Harness tap for the PR 13598 rig. Forwards every request,
// records method/path/status/duration (and the automation operation body),
// and applies fault rules set over a control port:
//   POST /rule {pathRe, bodyRe?, action: 'delay'|'drop'|'refuse', ms?, count?}
//     delay  - hold the request ms before forwarding
//     drop   - forward, let the Harness answer, then destroy the client
//              socket without a response (the answer is lost)
//     refuse - answer 503 without forwarding
//   DELETE /rules ; GET /rules
// usage: node tap.mjs <listenPort> <controlPort> <harnessPort> <logFile>
import { createServer, request } from 'node:http';
import { appendFileSync } from 'node:fs';

const [listen, control, harness, logFile] = process.argv.slice(2);
let rules = [];
let seq = 0;
const BODIES = process.env.TAP_BODIES === '1';
const log = (o) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const id = ++seq;
  const t0 = Date.now();
  const bodyText = body.toString('utf8');
  const rule = rules.find((r) => r.count !== 0 && new RegExp(r.pathRe).test(req.url) && (!r.bodyRe || new RegExp(r.bodyRe).test(bodyText)));
  if (rule && rule.count > 0) rule.count--;
  const auto = /automations\/operations/.test(req.url) ? (() => { try { const b = JSON.parse(bodyText); return { kind: b.kind, scheduleId: b.scheduleId, op: b.operationId, occ: b.occurrenceKey, rev: b.definitionRevision }; } catch { return {}; } })() : undefined;
  log({ id, dir: 'req', method: req.method, url: req.url, auto, rule: rule?.action, ...(BODIES ? { reqBody: bodyText.slice(0, 2500) } : {}) });
  if (rule?.action === 'refuse') {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"code":"tap_refused"}');
    log({ id, dir: 'res', status: 503, ms: Date.now() - t0, note: 'refused by tap' });
    return;
  }
  if (rule?.action === 'delay') await new Promise((r) => setTimeout(r, rule.ms));
  const up = request({ host: '127.0.0.1', port: Number(harness), method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${harness}` } }, (ur) => {
    if (rule?.action === 'drop') {
      const parts = [];
      ur.on('data', (c) => parts.push(c));
      ur.on('end', () => {
        log({ id, dir: 'res', status: ur.statusCode, ms: Date.now() - t0, note: 'DROPPED after Harness answered', body: Buffer.concat(parts).toString('utf8').slice(0, 600) });
        req.socket.destroy();
      });
      return;
    }
    res.writeHead(ur.statusCode, ur.headers);
    const parts = [];
    ur.on('data', (c) => { if (auto || BODIES) parts.push(c); });
    ur.pipe(res);
    ur.on('end', () => log({ id, dir: 'res', status: ur.statusCode, ms: Date.now() - t0, ...(auto || BODIES ? { body: Buffer.concat(parts).toString('utf8').slice(0, BODIES ? 2500 : 600) } : {}) }));
    ur.on('aborted', () => res.destroy());
    ur.on('error', () => res.destroy());
  });
  up.on('error', (e) => { log({ id, dir: 'err', error: String(e), ms: Date.now() - t0 }); if (!res.headersSent) res.writeHead(502); res.destroy(); });
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  up.end(body);
}).listen(Number(listen), '127.0.0.1');

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.method === 'POST' && req.url === '/rule') {
    const r = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    rules.push({ count: -1, ...r });
  } else if (req.method === 'DELETE') rules = [];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(rules));
}).listen(Number(control), '127.0.0.1');
console.log(`tap ${listen} -> ${harness}, control ${control}`);
