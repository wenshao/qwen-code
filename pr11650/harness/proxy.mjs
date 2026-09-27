// Reverse proxy in front of `qwen serve`: forwards everything, keeps a request
// ledger, and can hold the SSE frame carrying `session_rewound` (plus every frame
// behind it, preserving order) for a configurable delay.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.PORT);
const UP = Number(process.env.UPSTREAM);
const LEDGER = process.env.LEDGER;
const state = { delayRewoundMs: 0 };
const log = (o) => fs.appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), ...o }) + '\n');

http.createServer((req, res) => {
  if (req.url.startsWith('/__probe/arm')) {
    const u = new URL(req.url, 'http://x');
    state.delayRewoundMs = Number(u.searchParams.get('delayRewoundMs') ?? 0);
    log({ probe: 'arm', ...state });
    res.end(JSON.stringify(state));
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${UP}` };
  if (headers.origin) headers.origin = `http://127.0.0.1:${UP}`;
  const up = http.request({ host: '127.0.0.1', port: UP, method: req.method, path: req.url, headers }, (ur) => {
    const isSse = String(ur.headers['content-type'] ?? '').includes('text/event-stream');
    if (!/\.(js|css|svg|png|woff2?|ico|map)(\?|$)/.test(req.url) && !req.url.startsWith('/assets/'))
      log({ method: req.method, path: req.url.split('?')[0], status: ur.statusCode, sse: isSse || undefined });
    res.writeHead(ur.statusCode, ur.headers);
    if (!isSse) { ur.pipe(res); return; }
    let buf = '';
    let holdUntil = 0;
    const queue = [];
    let timer = null;
    const flush = () => {
      timer = null;
      if (Date.now() < holdUntil) { timer = setTimeout(flush, holdUntil - Date.now()); return; }
      while (queue.length) res.write(queue.shift());
    };
    ur.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i + 2);
        buf = buf.slice(i + 2);
        if (frame.includes('session_rewound')) {
          log({ sseFrame: 'session_rewound', path: req.url.split('?')[0], heldMs: state.delayRewoundMs });
          if (state.delayRewoundMs > 0) {
            holdUntil = Date.now() + state.delayRewoundMs;
            state.delayRewoundMs = 0; // one-shot
          }
        }
        if (Date.now() < holdUntil || queue.length) {
          queue.push(frame);
          if (!timer) timer = setTimeout(flush, Math.max(0, holdUntil - Date.now()));
        } else res.write(frame);
      }
    });
    ur.on('end', () => res.end());
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
  res.on('close', () => up.destroy());
}).listen(PORT, '127.0.0.1', () => console.log(`proxy ${PORT} -> ${UP}`));
