// VERIFICATION RIG ONLY: records every Spring -> Hosted Harness exchange and
// can inject faults on that boundary. Usage: node tap.mjs <listen> <target> <log>
//
// Faults come from <log>.rules.json, re-read per request:
//   [{ "id": "x", "method": "POST", "path": "^/session/[^/]+/load$",
//      "mode": "reply" | "rewrite" | "drop" | "lose", "status": 409,
//      "code": "rig_injected", "remaining": 1 }]
//   reply   - answer without forwarding (the Harness never sees the request)
//   rewrite - forward, then replace the Harness status/body
//   drop    - close the socket without forwarding
//   lose    - forward, let the Harness finish, then close without replying
import http from 'node:http';
import fs from 'node:fs';

const [listen, target, log] = [
  Number(process.argv[2]),
  Number(process.argv[3]),
  process.argv[4],
];
const rulesFile = `${log}.rules.json`;

function takeRule(method, path) {
  if (!fs.existsSync(rulesFile)) return undefined;
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
  } catch {
    return undefined;
  }
  const rule = rules.find(
    (r) =>
      r.remaining > 0 &&
      (!r.method || r.method === method) &&
      new RegExp(r.path).test(path),
  );
  if (!rule) return undefined;
  rule.remaining -= 1;
  fs.writeFileSync(rulesFile, JSON.stringify(rules));
  return rule;
}

const append = (entry) => fs.appendFileSync(log, JSON.stringify(entry) + '\n');

const streams = new Set();

http
  .createServer((req, res) => {
    if (req.url === "/__rig/cut") {
      // Rig control: sever every open event stream (a lost connection).
      const n = streams.size;
      for (const s of streams) s.destroy();
      append({ t: new Date().toISOString(), rig: "cut", streams: n });
      res.writeHead(200).end(String(n));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = {
        t: new Date().toISOString(),
        method: req.method,
        path: req.url,
      };
      try {
        const sid = JSON.parse(body.toString("utf8")).sessionId;
        if (typeof sid === "string") entry.sid = sid;
      } catch {
        // not a JSON body
      }
      const rule = takeRule(req.method, req.url);
      const injected = (headers) => {
        const payload = JSON.stringify({ code: rule.code ?? 'rig_injected' });
        res.writeHead(rule.status, {
          ...headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        });
        res.end(payload);
      };
      if (rule?.mode === 'drop') {
        append({ ...entry, fault: `drop:${rule.id}` });
        req.socket.destroy();
        return;
      }
      if (rule?.mode === 'reply') {
        append({ ...entry, fault: `reply:${rule.id}`, status: rule.status, code: rule.code });
        // The client validates the generation header on every response.
        injected({
          'x-qwen-harness-boot-id': req.headers['x-qwen-harness-boot-id'] ?? '',
        });
        return;
      }
      const upstream = http.request(
        {
          host: '127.0.0.1',
          port: target,
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${target}` },
        },
        (up) => {
          entry.status = up.statusCode;
          if (rule?.mode === 'lose') {
            // The Harness handled the request; its reply never arrives.
            entry.fault = `lose:${rule.id}`;
            entry.harnessStatus = up.statusCode;
            delete entry.status;
            up.resume();
            up.on('end', () => {
              append(entry);
              req.socket.destroy();
            });
            return;
          }
          if (rule?.mode === 'rewrite') {
            entry.fault = `rewrite:${rule.id}`;
            entry.harnessStatus = up.statusCode;
            entry.status = rule.status;
            entry.code = rule.code;
            up.resume();
            up.on('end', () => {
              append(entry);
              const headers = { ...up.headers };
              delete headers['content-length'];
              delete headers['transfer-encoding'];
              injected(headers);
            });
            return;
          }
          const sse = String(up.headers['content-type'] ?? '').includes('text/event-stream');
          if (sse || up.statusCode === 200 || up.statusCode === 202 || up.statusCode === 204) {
            if (sse) {
              streams.add(res);
              res.on('close', () => streams.delete(res));
            }
            append(entry);
            res.writeHead(up.statusCode, up.headers);
            up.on('aborted', () => res.destroy());
            up.on('error', () => res.destroy());
            up.on('close', () => {
              if (!up.complete) res.destroy();
            });
            up.pipe(res);
            return;
          }
          // Error replies are small: buffer them so the log keeps the code.
          const parts = [];
          up.on('data', (c) => parts.push(c));
          up.on('end', () => {
            const text = Buffer.concat(parts);
            try {
              entry.code = JSON.parse(text.toString('utf8')).code;
            } catch {
              entry.bodyBytes = text.length;
            }
            append(entry);
            res.writeHead(up.statusCode, up.headers);
            res.end(text);
          });
          up.on('error', () => res.destroy());
        },
      );
      upstream.on('error', (e) => {
        entry.error = e.code;
        append(entry);
        res.destroy();
      });
      res.on('close', () => upstream.destroy());
      upstream.end(body);
    });
  })
  .listen(listen, '127.0.0.1', () => console.log(`tap ${listen} -> ${target}`));
