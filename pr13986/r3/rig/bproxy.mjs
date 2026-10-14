// Harness → Broker fault proxy for the PR 13986 rig. Transparent by default;
// rules target one route suffix (e.g. "/tool-sessions:active-holds"):
//   {path, action:"status", status, body}   answer without forwarding
//   {path, action:"hang"}                   never answer (client timeout)
//   {path, action:"delay", ms}              forward after a delay
//   {path, action:"rewrite", body}          forward, then replace the JSON body
// Control: PUT /__rig/rules [..], GET /__rig/rules, GET /__rig/log, DELETE /__rig/log
import http from 'node:http';

const UPSTREAM = new URL(process.env.UPSTREAM ?? 'http://127.0.0.1:18987');
const PORT = Number(process.env.PORT ?? 18989);
let rules = [];
let log = [];

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

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
  const rule = rules.find((r) => url.pathname.endsWith(r.path));
  const entry = { at: new Date().toISOString(), method: req.method, path: url.pathname, rule: rule?.action ?? null, reqBody: body.length < 4096 ? body.toString() : `${body.length} bytes` };
  log.push(entry);
  if (log.length > 2000) log.shift();
  if (rule?.action === 'hang') { entry.status = 'hung'; return; }
  if (rule?.action === 'status') {
    entry.status = rule.status; entry.ms = Date.now() - t0;
    res.writeHead(rule.status, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(rule.body ?? { code: 'rig_injected' }));
  }
  if (rule?.action === 'delay') await new Promise((r) => setTimeout(r, rule.ms));
  const up = http.request({
    host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url,
    headers: { ...req.headers, host: UPSTREAM.host },
  }, (upRes) => {
    if (rule?.action !== 'rewrite' && !url.pathname.endsWith('active-holds')) {
      // Stream everything else untouched (never buffer a long-lived answer).
      entry.status = upRes.statusCode;
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
      upRes.on('end', () => { entry.ms = Date.now() - t0; });
      upRes.on('aborted', () => res.destroy());
      upRes.on('error', () => res.destroy());
      return;
    }
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('end', () => {
      let out = Buffer.concat(chunks);
      if (rule?.action === 'rewrite') {
        try {
          const parsed = JSON.parse(out.toString());
          out = Buffer.from(JSON.stringify({ ...parsed, ...rule.body }));
        } catch { /* leave non-JSON untouched */ }
      }
      entry.status = upRes.statusCode; entry.ms = Date.now() - t0;
      if (url.pathname.endsWith('active-holds')) entry.resBody = out.toString().slice(0, 2000);
      const headers = { ...upRes.headers };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      res.writeHead(upRes.statusCode, { ...headers, 'content-length': out.length });
      res.end(out);
    });
    upRes.on('error', () => res.destroy());
  });
  up.on('error', (e) => { entry.status = 'upstream-error'; entry.error = String(e); res.destroy(); });
  res.on('close', () => { if (!res.writableEnded) up.destroy(); });
  up.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`bproxy on ${PORT} -> ${UPSTREAM}`));
