// Fault proxy for the PR 14021 rig (Harness → Broker, or Harness → Session
// Store when started with UPSTREAM=<spring>). Transparent by default; a rule
// matches on path suffix (`path`) or regex (`pathRe`), optional `method`,
// optional request-body substring (`bodyHas`), and applies at most `times`
// times (default unlimited); `armedBy` keeps a rule inert until an earlier
// request's path/body contained that substring:
//   {action:"status", status, body, delayMs?} answer without forwarding
//   {action:"hang"}                        never answer (client timeout)
//   {action:"delay", ms}                   forward after a delay
//   {action:"rewrite", body}               forward, then replace the JSON body
//   {action:"fail-forward", status, ms}    answer `status` now, forward the
//                                          request upstream after `ms` (an
//                                          in-flight request the client gave up on)
// Control: PUT /__rig/rules [..], GET /__rig/rules, GET /__rig/log, DELETE /__rig/log
import http from 'node:http';

const UPSTREAM = new URL(process.env.UPSTREAM ?? 'http://127.0.0.1:18022');
const PORT = Number(process.env.PORT ?? 18024);
let rules = [];
let log = [];

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const seen = [];
function pick(req, url, body) {
  const text = body.length < 1024 * 1024 ? body.toString() : '';
  seen.push(url.pathname + ' ' + text.slice(0, 4096));
  if (seen.length > 200) seen.shift();
  for (const r of rules) {
    // armedBy: the rule stays inert until an earlier request (path or body)
    // contained this substring.
    if (r.armedBy && !r.armed) {
      if (seen.slice(0, -1).some((x) => x.includes(r.armedBy))) r.armed = true; else continue;
    }
    if (r.times !== undefined && (r.used ?? 0) >= r.times) continue;
    if (r.path && !url.pathname.endsWith(r.path)) continue;
    if (r.pathRe && !new RegExp(r.pathRe).test(url.pathname)) continue;
    if (r.method && r.method !== req.method) continue;
    if (r.bodyHas && !text.includes(r.bodyHas)) continue;
    r.used = (r.used ?? 0) + 1;
    return r;
  }
  return undefined;
}

function forward(req, body, entry, res) {
  const t0 = Date.now();
  const up = http.request({
    host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url,
    headers: { ...req.headers, host: UPSTREAM.host },
  }, (upRes) => {
    if (!res) {
      // Detached forward: the client already has its answer; record the
      // upstream verdict only.
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        entry.forwardedStatus = upRes.statusCode;
        entry.forwardedBody = Buffer.concat(chunks).toString().slice(0, 600);
        entry.forwardedAt = new Date().toISOString();
      });
      return;
    }
    entry.status = upRes.statusCode;
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
    upRes.on('end', () => { entry.ms = Date.now() - t0; });
    upRes.on('aborted', () => res.destroy());
    upRes.on('error', () => res.destroy());
  });
  up.on('error', (e) => { entry.status = 'upstream-error'; entry.error = String(e); res?.destroy(); });
  if (res) res.on('close', () => { if (!res.writableEnded) up.destroy(); });
  up.end(body);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://rig');
  if (url.pathname.startsWith('/__rig/')) {
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/__rig/rules' && req.method === 'PUT') { rules = JSON.parse((await readBody(req)).toString() || '[]'); return send({ rules: rules.length }); }
    if (url.pathname === '/__rig/rules') return send(rules);
    if (url.pathname === '/__rig/log' && req.method === 'DELETE') { log = []; return send({ ok: true }); }
    if (url.pathname === '/__rig/log') return send(log);
    res.writeHead(404); return res.end();
  }
  const body = await readBody(req);
  const t0 = Date.now();
  const rule = pick(req, url, body);
  const entry = { at: new Date().toISOString(), method: req.method, path: url.pathname, rule: rule?.action ?? null, reqBody: body.length < 2048 ? body.toString() : `${body.length} bytes` };
  log.push(entry);
  if (log.length > 4000) log.shift();
  if (rule?.action === 'hang') { entry.status = 'hung'; return; }
  if (rule?.action === 'status' || rule?.action === 'fail-forward') {
    if (rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
    entry.status = rule.status; entry.ms = Date.now() - t0;
    res.writeHead(rule.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rule.body ?? { code: 'rig_injected', error: 'rig injected fault' }));
    if (rule.action === 'fail-forward') {
      entry.forwardAfterMs = rule.ms;
      setTimeout(() => forward(req, body, entry, null), rule.ms);
    }
    return;
  }
  if (rule?.action === 'delay') await new Promise((r) => setTimeout(r, rule.ms));
  if (rule?.action === 'rewrite') {
    const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url, headers: { ...req.headers, host: UPSTREAM.host } }, (upRes) => {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        let out = Buffer.concat(chunks);
        try { out = Buffer.from(JSON.stringify({ ...JSON.parse(out.toString()), ...rule.body })); } catch { /* leave */ }
        entry.status = upRes.statusCode; entry.ms = Date.now() - t0;
        const headers = { ...upRes.headers };
        delete headers['content-length']; delete headers['transfer-encoding'];
        res.writeHead(upRes.statusCode, { ...headers, 'content-length': out.length });
        res.end(out);
      });
    });
    up.on('error', (e) => { entry.status = 'upstream-error'; entry.error = String(e); res.destroy(); });
    return up.end(body);
  }
  forward(req, body, entry, res);
}).listen(PORT, '127.0.0.1', () => console.log(`bproxy on ${PORT} -> ${UPSTREAM}`));
