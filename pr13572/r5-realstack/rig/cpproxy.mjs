// Fault proxy between the managed email adapter and the control plane's
// internal listener (PR 13572 rig). Buffers each request/response (no pipe,
// so an upstream abort is visible). Rules are consumed in order:
//   POST /rule?match=<regex>&action=<a>&n=<k>
//     action drop-response  forward, let the server commit, then destroy the client socket
//     action refuse         destroy the client socket without forwarding
//     action delay:<ms>     forward after <ms>
//   POST /down | /up        refuse every request while down
//   GET  /log               every request with its fate
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync } from 'node:fs';

const [listenPort, upstreamPort, controlPort] = process.argv.slice(2).map(Number);
const LOG = '/Users/wenshao/git/pr13572-rig/mail/cpproxy.jsonl';
const rules = [];
const ledger = [];
let down = false;
const record = (entry) => {
  const line = { t: new Date().toISOString(), ...entry };
  ledger.push(line);
  appendFileSync(LOG, JSON.stringify(line) + '\n');
};

function summarize(path, body) {
  try {
    const json = JSON.parse(body.toString('utf8') || '{}');
    if (path.endsWith('/inbound')) return { event: json.platformEventId, gen: json.accountGeneration, text: String(json.text ?? '').slice(0, 40), att: (json.attachments ?? []).length };
    if (path.includes(':receipt')) return { receipt: json };
    if (path.includes(':claim')) return { limit: json.limit };
    if (path.endsWith('/disconnect')) return {};
    return { gen: json.accountGeneration, policy: json.policy };
  } catch {
    return { bytes: body.length };
  }
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const path = req.url;
    const started = Date.now();
    const info = { method: req.method, path: path.replace(/^\/internal\/managed-channels\/v1\/channels\//, ''), ...summarize(path, body) };
    if (down) {
      record({ ...info, fate: 'refused (down)' });
      return req.socket.destroy();
    }
    const index = rules.findIndex((r) => new RegExp(r.match).test(`${req.method} ${path}`));
    const rule = index >= 0 ? rules[index] : undefined;
    if (rule) {
      rule.n -= 1;
      if (rule.n <= 0) rules.splice(index, 1);
    }
    if (rule?.action === 'refuse') {
      record({ ...info, fate: 'refused (rule)' });
      return req.socket.destroy();
    }
    const forward = () => {
      const up = httpRequest(
        { host: '127.0.0.1', port: upstreamPort, method: req.method, path, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } },
        (upRes) => {
          const out = [];
          upRes.on('data', (c) => out.push(c));
          upRes.on('aborted', () => req.socket.destroy());
          upRes.on('end', () => {
            const payload = Buffer.concat(out);
            const status = upRes.statusCode;
            let answer;
            try { answer = JSON.parse(payload.toString('utf8')); } catch { answer = payload.toString('utf8').slice(0, 200); }
            if (rule?.action === 'drop-response') {
              record({ ...info, status, fate: 'answer dropped (rule)', ms: Date.now() - started, answer });
              return req.socket.destroy();
            }
            record({ ...info, status, fate: 'forwarded', ms: Date.now() - started, answer });
            res.writeHead(status, upRes.headers);
            res.end(payload);
          });
        },
      );
      up.on('error', (e) => {
        record({ ...info, fate: `upstream error ${e.code ?? e.message}` });
        req.socket.destroy();
      });
      up.end(body);
    };
    if (rule?.action?.startsWith('delay:')) setTimeout(forward, Number(rule.action.slice(6)));
    else forward();
  });
}).listen(listenPort, '127.0.0.1', () => console.log(`proxy ${listenPort} -> ${upstreamPort}`));

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/rule') {
    rules.push({ match: url.searchParams.get('match'), action: url.searchParams.get('action'), n: Number(url.searchParams.get('n') ?? '1') });
    return res.end(JSON.stringify(rules) + '\n');
  }
  if (req.method === 'POST' && url.pathname === '/down') { down = true; return res.end('down\n'); }
  if (req.method === 'POST' && url.pathname === '/up') { down = false; return res.end('up\n'); }
  if (req.method === 'POST' && url.pathname === '/clear') { rules.length = 0; return res.end('[]\n'); }
  if (url.pathname === '/log') return res.end(JSON.stringify({ down, rules, ledger }, null, 1) + '\n');
  res.statusCode = 404;
  res.end();
}).listen(controlPort, '127.0.0.1', () => console.log(`control ${controlPort}`));
