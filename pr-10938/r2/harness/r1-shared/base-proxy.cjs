#!/usr/bin/env node
// Serves the BASE web-shell bundle on its own port while proxying every daemon
// route to the one real daemon, so both arms render the SAME live session at
// the same moment. Static hits come from the base bundle; everything else
// (REST, SSE) is piped to the daemon with Host/Origin rewritten to the daemon's.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4939);
const DAEMON = Number(process.env.DAEMON_PORT || 4938);
const ROOT = process.env.ROOT;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(url.pathname);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    // SPA navigation (`/session/<id>?view=cockpit`) shares a prefix with the
    // REST routes, so a document request gets the base index.html.
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
    }
    const headers = { ...req.headers, host: `127.0.0.1:${DAEMON}` };
    if (headers.origin) headers.origin = `http://127.0.0.1:${DAEMON}`;
    if (headers.referer) headers.referer = headers.referer.replace(`:${PORT}`, `:${DAEMON}`);
    const up = http.request(
      { host: '127.0.0.1', port: DAEMON, method: req.method, path: req.url, headers },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(up);
    res.on('close', () => up.destroy());
  })
  .listen(PORT, '127.0.0.1', () => console.log(`base proxy ${PORT} -> daemon ${DAEMON}, root=${ROOT}`));
