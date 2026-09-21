// Transparent HTTP proxy in front of the real daemon that makes it look like an
// OLDER daemon: `session_turn_navigation` is removed from GET /capabilities and
// /turn-index answers 404. Everything else (static UI, SSE, REST) passes through.
import http from 'node:http';
const [, , listen = '14235', target = '14234'] = process.argv;
let stripped = 0;
let turnIndexHits = 0;
http
  .createServer((req, res) => {
    if (req.url === '/__stats') {
      res.end(JSON.stringify({ stripped, turnIndexHits }));
      return;
    }
    if (/\/turn-index(\?|$)/.test(req.url)) {
      turnIndexHits += 1;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${target}` };
    delete headers.origin;
    delete headers.referer;
    const isCaps = req.url.split('?')[0] === '/capabilities';
    if (isCaps) delete headers['accept-encoding'];
    const up = http.request({ host: '127.0.0.1', port: Number(target), method: req.method, path: req.url, headers }, (r) => {
      if (!isCaps) {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
        return;
      }
      let raw = '';
      r.on('data', (c) => (raw += c));
      r.on('end', () => {
        try {
          const body = JSON.parse(raw);
          if (Array.isArray(body.features)) {
            body.features = body.features.filter((f) => f !== 'session_turn_navigation');
            stripped += 1;
          }
          raw = JSON.stringify(body);
        } catch {
          /* pass through */
        }
        const h = { ...r.headers };
        delete h['content-length'];
        delete h['etag'];
        res.writeHead(r.statusCode, h);
        res.end(raw);
      });
    });
    up.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  })
  .listen(Number(listen), '127.0.0.1', () => console.log(`LEGACY_PROXY_READY http://127.0.0.1:${listen}`));
