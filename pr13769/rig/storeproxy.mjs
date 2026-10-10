// Session Store hold-proxy for the PR 13769 rig.
// The Harness reaches the Session Store through this proxy (Spring advertises
// it as session-store.base-url). Every request is forwarded unchanged, except
// one armed rule: the first POST .../transactions:commit whose body (or any
// base64 string inside it, decoded) contains every '&&'-separated part of
// the armed marker in one text is HELD — never
// forwarded, never answered — so the commit is provably lost when the
// Harness is then killed. One-shot: the rule disarms after its first hold.
// usage: node storeproxy.mjs <listenPort> <upstreamPort> <controlPort> <logFile>
//   control: GET /arm?[path=<substr>][&marker=<a&&b>][&session=<id>][&after=<a&&b>] | /disarm | /held
//   (path defaults to /transactions:commit; an empty marker matches on path alone)
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const [listenPort, upstreamPort, controlPort, logFile] = process.argv.slice(2);
let rule = null;
const held = [];
const log = (o) => appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');

function decodedTexts(value, out) {
  if (typeof value === 'string') {
    out.push(value);
    if (value.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      try { out.push(Buffer.from(value, 'base64').toString('utf8')); } catch {}
    }
  } else if (Array.isArray(value)) value.forEach((v) => decodedTexts(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => decodedTexts(v, out));
  return out;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const path = req.url ?? '';
    if (rule && req.method === 'POST' && path.includes(rule.path) &&
        (!rule.session || path.includes(rule.session) || body.includes(rule.session))) {
      let texts = [body.toString('utf8')];
      try { texts = decodedTexts(JSON.parse(body.toString('utf8')), texts); } catch {}
      // 'after' mode: let the first commit matching `after` through, then
      // hold the NEXT commit on that same session (fold durable, die before
      // the follow-up write).
      if (rule.after && !rule.afterSeen) {
        const ap = rule.after.split('&&');
        if (texts.some((t) => ap.every((m) => t.includes(m)))) {
          rule.afterSeen = true;
          rule.session = (path.match(/sessions\/([^/]+)\//) ?? [])[1] ?? rule.session;
          log({ afterSeen: true, path: path.slice(0, 160), session: rule.session });
        }
        texts = null;
      }
      const parts = rule.marker ? rule.marker.split('&&') : [];
      const hit = texts === null ? undefined : texts.find((t) => parts.every((m) => t.includes(m)));
      if (hit !== undefined) {
        const at0 = parts.length ? Math.max(0, hit.indexOf(parts[0]) - 260) : 0;
        const entry = { path: path.slice(0, 160), bytes: body.length, marker: rule.marker, at: new Date().toISOString(), snippet: hit.slice(at0, at0 + 520) };
        held.push(entry);
        log({ held: true, ...entry });
        rule = null; // one-shot
        req.socket.on('close', () => log({ heldClosed: true, path: entry.path }));
        return; // never forwarded, never answered
      }
    }
    const up = http.request({
      host: '127.0.0.1', port: Number(upstreamPort), method: req.method, path,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}`, 'content-length': String(body.length) },
    }, (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.pipe(res);
      ur.on('aborted', () => res.destroy());
      ur.on('error', () => res.destroy());
      if (req.method === 'POST') log({ m: req.method, path: path.slice(0, 120), bytes: body.length, status: ur.statusCode });
    });
    up.on('error', (e) => { log({ upstreamError: String(e), path: path.slice(0, 120) }); res.destroy(); });
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    up.end(body);
  });
}).listen(Number(listenPort), '127.0.0.1', () => console.log(`STOREPROXY ${listenPort} -> ${upstreamPort}`));

http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/arm') {
    rule = {
      path: u.searchParams.get('path') || '/transactions:commit',
      marker: u.searchParams.get('marker') || '',
      session: u.searchParams.get('session') || null,
      after: u.searchParams.get('after') || null,
      afterSeen: false,
    };
    log({ armed: rule });
    res.end(JSON.stringify({ armed: rule }) + '\n');
  } else if (u.pathname === '/disarm') {
    rule = null; res.end('disarmed\n');
  } else if (u.pathname === '/held') {
    res.end(JSON.stringify({ armed: rule, held }) + '\n');
  } else { res.statusCode = 404; res.end(); }
}).listen(Number(controlPort), '127.0.0.1', () => console.log(`CONTROL ${controlPort}`));
