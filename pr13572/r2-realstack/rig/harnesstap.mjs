// Wire tap between Spring and the Hosted Harness (PR 13572 rig): forwards
// every request byte-for-byte and records the body and answer of each
// channel operation, so what the control plane actually sent is evidence.
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync } from 'node:fs';

const [listenPort, upstreamPort] = process.argv.slice(2).map(Number);
const LOG = '/Users/wenshao/git/pr13572-rig/mail/harnesstap.jsonl';
createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const up = httpRequest(
      { host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } },
      (upRes) => {
        const out = [];
        upRes.on('data', (c) => out.push(c));
        upRes.on('aborted', () => req.socket.destroy());
        upRes.on('end', () => {
          const payload = Buffer.concat(out);
          if (/\/channels\/operations$|^\/session$|\/load$/.test(req.url.split('?')[0])) {
            let sent; let answer;
            try { sent = JSON.parse(body.toString('utf8')); } catch { sent = body.length; }
            try { answer = JSON.parse(payload.toString('utf8')); } catch { answer = payload.toString('utf8').slice(0, 300); }
            if (sent && typeof sent === 'object') {
              for (const a of sent.attachments ?? []) if (a.bytesBase64) a.bytesBase64 = `<${a.bytesBase64.length} chars>`;
              if (sent.managedSessionStore) sent.managedSessionStore = '<redacted>';
            }
            appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.url, status: upRes.statusCode, sent, answer }) + '\n');
          }
          res.writeHead(upRes.statusCode, upRes.headers);
          res.end(payload);
        });
      },
    );
    up.on('error', () => req.socket.destroy());
    up.end(body);
  });
}).listen(listenPort, '127.0.0.1', () => console.log(`tap ${listenPort} -> ${upstreamPort}`));
