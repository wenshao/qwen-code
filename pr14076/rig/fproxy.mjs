// Spring -> Harness fault proxy for the PR 14076 rig (streaming pass-through).
// usage: node fproxy.mjs <listenPort> <harnessPort> <controlPort> <logFile>
// control: GET /arm?mode=drop|hold|fail&path=<substr>&body=<substr>&count=N | /disarm | /log
//   drop: forward, read the whole upstream answer, log it, then destroy the client socket (lost reply)
//   hold: never forward, never answer (until /disarm, which destroys held sockets)
//   fail: answer 503 without forwarding
// Every POST whose path contains /children/operations is logged with its body and status.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const [lp, hp, cp, logf] = process.argv.slice(2);
let rule = null; const held = [];
const log = (o) => appendFileSync(logf, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks); const path = req.url ?? ''; const text = body.toString('utf8');
    const watched = req.method === 'POST' && path.includes('/children/operations');
    let mode = null;
    if (rule && req.method === 'POST' && path.includes(rule.path) && (!rule.body || text.includes(rule.body)) && rule.count > 0) {
      mode = rule.mode; rule.count -= 1; if (rule.count <= 0) rule = null;
    }
    if (mode === 'hold') { held.push(res); log({ fault: 'hold', path, body: text.slice(0, 400) }); return; }
    if (mode === 'fail') { log({ fault: 'fail', path, body: text.slice(0, 400) }); res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"code":"rig_fault"}}'); return; }
    const up = http.request({ host: '127.0.0.1', port: Number(hp), method: req.method, path,
      headers: { ...req.headers, host: `127.0.0.1:${hp}`, 'content-length': String(body.length) } }, (ur) => {
      if (mode === 'drop') {
        const out = []; ur.on('data', (c) => out.push(c));
        ur.on('end', () => { log({ fault: 'drop', path, body: text.slice(0, 400), upstreamStatus: ur.statusCode, upstreamBody: Buffer.concat(out).toString('utf8').slice(0, 400) }); req.socket.destroy(); });
        return;
      }
      const out = [];
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.on('data', (c) => { if (watched || (ur.statusCode ?? 0) >= 400) out.push(c); res.write(c); });
      ur.on('end', () => { if (watched || (ur.statusCode ?? 0) >= 400) log({ m: req.method, path: path.slice(0, 160), status: ur.statusCode, body: watched ? text.slice(0, 400) : undefined, answer: Buffer.concat(out).toString('utf8').slice(0, 400) }); res.end(); });
      ur.on('aborted', () => res.destroy()); ur.on('error', () => res.destroy());
    });
    up.on('error', (e) => { log({ upstreamError: String(e), path: path.slice(0, 120), body: watched ? text.slice(0, 200) : undefined }); res.destroy(); });
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    up.end(body);
  });
}).listen(Number(lp), '127.0.0.1', () => console.log(`FPROXY ${lp} -> ${hp}`));
http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/arm') { rule = { mode: u.searchParams.get('mode') ?? 'drop', path: u.searchParams.get('path') ?? '/children/operations', body: u.searchParams.get('body') ?? '', count: Number(u.searchParams.get('count') ?? 1) }; log({ armed: rule }); res.end(JSON.stringify({ armed: rule }) + '\n'); }
  else if (u.pathname === '/disarm') { rule = null; const n = held.length; while (held.length) held.pop().socket?.destroy(); log({ disarmed: true, releasedHeld: n }); res.end(`disarmed ${n}\n`); }
  else if (u.pathname === '/state') { res.end(JSON.stringify({ rule, held: held.length }) + '\n'); }
  else { res.statusCode = 404; res.end(); }
}).listen(Number(cp), '127.0.0.1', () => console.log(`FCONTROL ${cp}`));
