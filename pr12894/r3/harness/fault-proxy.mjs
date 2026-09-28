// VERIFICATION RIG ONLY (PR #12894): transparent HTTP proxy in front of the Java
// server (publication ingress + Session Store) with path-matched fault rules.
// data: 127.0.0.1:18895 -> 127.0.0.1:18894 ; control: 127.0.0.1:18896
import http from 'node:http';

const TARGET = process.env.TARGET ?? 'http://127.0.0.1:18894';
const rules = []; // { match, method, action, count, ms, hits }
const ledger = [];
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function pick(req) {
  for (const r of rules) {
    if (r.count <= 0) continue;
    if (r.forMs && !r.until) r.until = Date.now() + r.forMs;
    if (r.until && Date.now() > r.until) continue;
    if (r.method && r.method !== req.method) continue;
    if (!new RegExp(r.match).test(req.url)) continue;
    r.count--; r.hits = (r.hits ?? 0) + 1;
    return r;
  }
  return null;
}

const data = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const entry = { t: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, ''), status: null, fault: null };
    ledger.push(entry);
    if (ledger.length > 50000) ledger.splice(0, 10000);
    const rule = pick(req);
    if (rule) entry.fault = rule.action;
    if (rule?.action === 'drop-request') { entry.status = 'dropped-before-server'; return req.socket.destroy(); }
    if (rule?.action === '503') { entry.status = '503-injected'; res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ error: { code: 'injected_unavailable', message: 'injected' } })); }
    if (rule?.action === 'delay') await new Promise((r) => setTimeout(r, rule.ms ?? 1000));
    const headers = { ...req.headers };
    delete headers['content-length'];
    const up = http.request(new URL(req.url, TARGET), { method: req.method, headers: { ...headers, 'content-length': body.length }, agent }, (upRes) => {
      const out = [];
      upRes.on('data', (c) => out.push(c));
      upRes.on('end', () => {
        entry.status = upRes.statusCode;
        const payload = Buffer.concat(out);
        if (upRes.statusCode >= 400) entry.body = payload.toString('utf8').slice(0, 200);
        if (rule?.action === 'drop-reply') { entry.status += '-reply-dropped'; return req.socket.destroy(); }
        if (rule?.action === 'forward-then-hold') { entry.status += '-held'; return; }
        if (rule?.action === 'hook-after') process.emit('rig-hook', rule, entry);
        const h = { ...upRes.headers };
        delete h['transfer-encoding'];
        h['content-length'] = payload.length;
        res.writeHead(upRes.statusCode, h);
        res.end(payload);
      });
    });
    up.on('error', (e) => { entry.status = `upstream-error ${e.message}`; res.writeHead(502); res.end(); });
    up.end(body);
  });
});
data.keepAliveTimeout = 60_000;
data.listen(18895, '127.0.0.1', () => console.log('fault proxy data 18895 ->', TARGET));

const control = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (url.pathname === '/rule') { rules.push({ ...body, hits: 0 }); return send(rules); }
  if (url.pathname === '/clear') { rules.length = 0; return send([]); }
  if (url.pathname === '/rules') return send(rules);
  if (url.pathname === '/ledger') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return send(ledger.filter((e) => e.t >= since));
  }
  res.writeHead(404); res.end();
});
control.listen(18896, '127.0.0.1', () => console.log('fault proxy control 18896'));
