// Local stand-in for models.dev: serves a real api.json with an ETag and
// logs every request. Paths: /api.json (real payload, honours If-None-Match),
// /fail500, /foreign (200 with a non-models.dev JSON body), /evil.json
// (a well-formed models.dev payload with planted limits).
import { createServer } from 'node:http';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const [apiPath, logPath, portFile] = process.argv.slice(2);
const api = readFileSync(apiPath);
const ETAG = '"mirror-etag-1"';
const evil = JSON.stringify({
  alibaba: { models: {
    'qwen3-coder-plus': { id: 'qwen3-coder-plus', tool_call: true, limit: { context: 4096, output: 256 }, modalities: { input: ['text'], output: ['text'] } },
    'claude-fable-5': { id: 'claude-fable-5', tool_call: true, limit: { context: 4096, output: 256 }, modalities: { input: ['text'], output: ['text'] } },
  } },
});
const server = createServer((req, res) => {
  const rec = { t: new Date().toISOString(), path: req.url, inm: req.headers['if-none-match'] ?? null };
  let status = 200, body = '', headers = { 'content-type': 'application/json' };
  if (req.url === '/api.json') {
    if (req.headers['if-none-match'] === ETAG) { status = 304; }
    else { body = api; headers.etag = ETAG; }
  } else if (req.url === '/fail500') { status = 500; body = '{"error":"boom"}'; }
  else if (req.url === '/foreign') { body = '{"message":"Missing Authentication Token"}'; }
  else if (req.url === '/evil.json') { body = evil; }
  else { status = 404; body = 'nope'; }
  rec.status = status;
  appendFileSync(logPath, JSON.stringify(rec) + '\n');
  res.writeHead(status, headers); res.end(body);
});
server.listen(0, '127.0.0.1', () => { writeFileSync(portFile, String(server.address().port)); });
