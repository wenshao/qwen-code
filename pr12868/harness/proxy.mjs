// Verification rig for PR #12868: HTTP forward proxy placed between the Java
// Runtime Broker and its owned workers (JVM -Dhttp.proxyHost/-Dhttp.proxyPort
// with an empty http.nonProxyHosts). It keeps a JSONL ledger of every
// Broker -> worker request and can inject faults on matching requests.
//
// usage: node proxy.mjs <listenPort> <ledger.jsonl>
// control: POST /__rig/hook {kind, path, action, count, delayMs}  -> arm a fault
//          POST /__rig/clear                                       -> disarm
import { createServer, request as httpRequest } from 'node:http';
import fs from 'node:fs';

const [port, ledgerPath] = [Number(process.argv[2]), process.argv[3]];
const hooks = [];
let seq = 0;

function log(entry) {
  fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
}

function redact(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/^x-qwen-|^content-type$|^cache-control$/i.test(k)) out[k] = v;
    if (/^authorization$/i.test(k)) out[k] = 'Bearer <redacted>';
  }
  return out;
}

function parse(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (req.url.startsWith('/__rig/')) {
    if (req.url === '/__rig/hook') hooks.push({ count: 1, ...parse(body) });
    if (req.url === '/__rig/clear') hooks.length = 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hooks }));
    return;
  }
  const target = new URL(req.url);
  const json = parse(body);
  const kind = json?.operation?.kind;
  const entry = {
    seq: ++seq,
    t: Date.now(),
    method: req.method,
    port: Number(target.port),
    path: target.pathname,
    ...(kind ? { kind } : {}),
    requestBytes: body.length,
    request: json,
    headers: redact(req.headers),
  };
  const hook = hooks.find(
    (h) =>
      h.count > 0 &&
      (h.path === undefined || h.path === target.pathname) &&
      (h.kind === undefined || h.kind === kind),
  );
  if (hook) {
    hook.count--;
    entry.fault = hook.action;
  }
  if (hook?.action === 'drop-request') {
    log({ ...entry, status: 'dropped-before-worker' });
    req.socket.destroy();
    return;
  }
  if (hook?.action === 'delay') await new Promise((r) => setTimeout(r, hook.delayMs));
  const headers = { ...req.headers };
  delete headers['proxy-connection'];
  headers.host = target.host;
  const upstream = httpRequest(
    {
      host: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (up) => {
      const parts = [];
      up.on('data', (c) => parts.push(c));
      up.on('end', () => {
        const answer = Buffer.concat(parts);
        const parsed = parse(answer);
        log({
          ...entry,
          ms: Date.now() - entry.t,
          status: up.statusCode,
          responseBytes: answer.length,
          response: answer.length > 6000 ? { truncated: answer.length, code: parsed?.code } : parsed,
        });
        if (hook?.action === 'drop-reply') {
          req.socket.destroy();
          return;
        }
        res.writeHead(up.statusCode, up.headers);
        res.end(answer);
      });
    },
  );
  upstream.on('error', (error) => {
    log({ ...entry, status: `upstream-error ${error.code ?? error.message}` });
    req.socket.destroy();
  });
  upstream.end(body);
});
server.keepAliveTimeout = 0;
server.listen(port, '127.0.0.1', () => console.log(`rig proxy listening on ${port}`));
