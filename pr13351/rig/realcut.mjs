// VERIFICATION RIG ONLY (PR #13351): cutting proxy in front of a real OpenAI-compatible provider.
// usage: node realcut.mjs <port> <upstreamBaseUrlFile> <log.jsonl>
// Requests whose most recent marked user message carries "REALCUT id=<x>" are cut on their first attempt:
// the first SSE frame with non-empty delta.content is forwarded, then the proxy waits for
// POST /__rig/release?id=<x> (or 20 s) and destroys the client socket. Later attempts pass through.
// The Authorization header from the Harness is forwarded unchanged; nothing here reads or logs credentials.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const [port, upstreamFile, log] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const upstream = new URL(fs.readFileSync(upstreamFile, 'utf8').trim().replace(/\/$/, '') + '/');
const attempts = new Map();
const releases = new Map();
const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const write = (e) => fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');

http
  .createServer((req, res) => {
    if (req.url?.startsWith('/__rig/release')) {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      const f = releases.get(id);
      releases.delete(id);
      f?.();
      res.end(JSON.stringify({ released: Boolean(f) }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let body = {};
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {}
      const messages = body.messages ?? [];
      let marker;
      for (const m of messages) if (m.role === 'user') marker = [...text(m.content).matchAll(/REALCUT id=([A-Za-z0-9-]+)/g)].at(-1)?.[1] ?? marker;
      const attempt = marker ? (attempts.get(marker) ?? 0) + 1 : 0;
      if (marker) attempts.set(marker, attempt);
      const cut = marker && attempt === 1 && body.stream === true;
      const serialized = JSON.stringify(messages);
      const entry = {
        id: marker ?? null,
        attempt,
        path: req.url,
        bodySha: sha(raw.toString('utf8')),
        roles: messages.map((m) => m.role).join(','),
        resumeInstruction: serialized.includes('The connection dropped mid-response'),
        cut: Boolean(cut),
      };
      if (marker) fs.writeFileSync(`${log}.body-${marker}-a${attempt}.json`, raw);
      const target = new URL(req.url.replace(/^\/v1\//, '').replace(/^\//, ''), upstream);
      const headers = { ...req.headers, host: target.host };
      delete headers['content-length'];
      headers['content-length'] = String(raw.length);
      const client = target.protocol === 'https:' ? https : http;
      const up = client.request(target, { method: req.method, headers }, (ur) => {
        entry.status = ur.statusCode;
        if (!cut) {
          write(entry);
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
          return;
        }
        res.writeHead(ur.statusCode, ur.headers);
        let buf = '';
        let forwardedContent = '';
        let cutting = false;
        ur.setEncoding('utf8');
        ur.on('data', (d) => {
          if (cutting) return;
          buf += d;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i + 2);
            buf = buf.slice(i + 2);
            res.write(frame);
            const m = frame.match(/^data: (.*)$/m);
            let content = '';
            try {
              content = JSON.parse(m?.[1] ?? '{}').choices?.[0]?.delta?.content ?? '';
            } catch {}
            if (content) {
              forwardedContent += content;
              cutting = true;
              entry.forwardedBeforeCut = forwardedContent;
              const timer = setTimeout(() => finish('timeout'), 20_000);
              const finish = (how) => {
                clearTimeout(timer);
                entry.cutHow = how;
                write(entry);
                up.destroy();
                res.socket?.destroy();
              };
              releases.set(marker, () => finish('released'));
              return;
            }
          }
        });
      });
      up.on('error', (e) => {
        entry.error = e.code ?? String(e);
        if (!cut) write(entry);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      up.end(raw);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`realcut ${port} -> ${upstream.origin}${upstream.pathname}`));
