// A model endpoint that refuses every request with a non-retryable 400, and logs each hit.
// usage: node bad-model.mjs <port> <log file>
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const [, , port, log] = process.argv;
http.createServer((req, res) => {
  let n = 0; req.on('data', (c) => (n += c.length));
  req.on('end', () => {
    appendFileSync(log, `${new Date().toISOString()} ${req.method} ${req.url} bytes=${n}\n`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'PROBE: model refuses this request', type: 'invalid_request_error', code: 'probe_bad_request' } }));
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`bad-model listening on ${port} pid=${process.pid}`));
