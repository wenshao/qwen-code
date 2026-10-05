// VERIFICATION RIG ONLY: Spring -> Hosted Harness recording proxy with fault rules.
// usage: node tap.mjs <listen> <target> <log> <rules.json>
// rules.json: [{ "match": "POST .*/resolve", "action": "drop-before"|"drop-after"|"delay"|"respond", "times": N, "delayMs": n, "status": n, "body": {...} }]
//   drop-before  close the client socket without forwarding (request never reaches the Harness)
//   drop-after   forward, wait for the Harness's complete answer, then close the client socket (lost reply)
//   delay        forward after delayMs
//   respond      answer status/body without forwarding
// Rules are re-read when the file changes; "times" counts down in memory (absent = unlimited).
import http from 'node:http';
import fs from 'node:fs';

const [listen, target, log, rulesFile] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
let rules = []; let stamp = 0;
// Harness identity headers (boot ID) seen on real answers; replayed on fabricated ones so the Java client accepts them as this Harness's.
let identity = {};
function loadRules() {
  try {
    const m = fs.statSync(rulesFile).mtimeMs;
    if (m !== stamp) { stamp = m; rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')).map((r) => ({ ...r, left: r.times ?? Infinity, re: new RegExp(r.match) })); }
  } catch { rules = []; stamp = 0; }
}
const write = (e) => fs.appendFileSync(log, JSON.stringify(e) + '\n');

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      loadRules();
      const line = `${req.method} ${req.url}`;
      const rule = rules.find((r) => r.left > 0 && r.re.test(line));
      if (rule) rule.left -= 1;
      const entry = { t: new Date().toISOString(), method: req.method, path: req.url };
      if (body.length) { try { entry.body = JSON.parse(body.toString('utf8')); } catch { entry.bodyBytes = body.length; } }
      if (rule) entry.fault = rule.action;
      if (rule?.action === 'drop-before') { write(entry); req.socket.destroy(); return; }
      if (rule?.action === 'respond') { entry.status = rule.status; write(entry); res.writeHead(rule.status, { 'Content-Type': 'application/json', ...identity }); res.end(JSON.stringify(rule.body ?? {})); return; }
      if (rule?.action === 'delay') await new Promise((r) => setTimeout(r, rule.delayMs));
      // VERIFICATION RIG ONLY (PR #13354): 'inject' merges rule.merge into the JSON body (simulates a coordinator that pins a Hook catalog).
      let forwardBody = body;
      if (rule?.action === 'inject') { const parsed = JSON.parse(body.toString('utf8')); Object.assign(parsed, rule.merge); forwardBody = Buffer.from(JSON.stringify(parsed)); entry.injected = Object.keys(rule.merge); }
      const upstream = http.request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}`, ...(forwardBody !== body ? { 'content-length': String(forwardBody.length) } : {}) } },
        (up) => {
          entry.status = up.statusCode;
          const seen = Object.fromEntries(Object.entries(up.headers).filter(([k]) => k.startsWith('x-qwen')));
          if (Object.keys(seen).length) identity = seen;
          if (rule?.action === 'drop-after') {
            const parts = [];
            up.on('data', (c) => parts.push(c));
            up.on('end', () => { try { entry.upstreamBody = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch {} write(entry); req.socket.destroy(); });
            return;
          }
          const sse = String(up.headers['content-type'] ?? '').includes('text/event-stream');
          if (!sse && req.url.includes('/actions/')) {
            const parts = [];
            up.on('data', (c) => parts.push(c));
            up.on('end', () => { const buf = Buffer.concat(parts); try { entry.upstreamBody = JSON.parse(buf.toString('utf8')); } catch {} write(entry); res.writeHead(up.statusCode, up.headers); res.end(buf); });
            return;
          }
          const rewrite = sse && rules.find((r) => r.action === 'sse-tool-call' && r.left > 0);
          if (rewrite) {
            // VERIFICATION RIG ONLY: turn the agent_message_chunk that carries rewrite.marker into a tool_call
            // session update with arguments, keeping the frame's id, so the Java projector sees what a Harness
            // that publishes tool calls would send.
            write(entry);
            res.writeHead(up.statusCode, up.headers);
            let buf = '';
            up.setEncoding('utf8');
            up.on('data', (chunk) => {
              buf += chunk;
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                let frame = buf.slice(0, i + 2);
                buf = buf.slice(i + 2);
                const m = frame.match(/^data: (.*)$/m);
                if (m && rewrite.left > 0) {
                  try {
                    const ev = JSON.parse(m[1]);
                    const u = ev?.data?.update;
                    if (ev.type === 'session_update' && u?.sessionUpdate === 'agent_message_chunk' && String(u?.content?.text ?? '').includes(rewrite.marker)) {
                      ev.data.update = { sessionUpdate: 'tool_call', toolCallId: rewrite.toolCallId, title: 'WriteFile', status: 'pending', kind: 'edit', name: 'write_file', rawInput: rewrite.rawInput, input: rewrite.rawInput, content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(rewrite.rawInput) } }] };
                      frame = frame.replace(m[1], JSON.stringify(ev));
                      rewrite.left -= 1;
                      write({ t: new Date().toISOString(), fault: 'sse-tool-call', frame: frame.slice(0, 600) });
                    }
                  } catch {}
                }
                res.write(frame);
              }
            });
            up.on('end', () => { if (buf) res.write(buf); res.end(); });
            up.on('aborted', () => res.destroy());
            up.on('error', () => res.destroy());
            return;
          }
          write(entry);
          res.writeHead(up.statusCode, up.headers);
          up.on('aborted', () => res.destroy());
          up.on('error', () => res.destroy());
          up.on('close', () => { if (!up.complete) res.destroy(); });
          up.pipe(res);
        },
      );
      upstream.on('error', (e) => { entry.error = e.code; write(entry); res.destroy(); });
      res.on('close', () => upstream.destroy());
      upstream.end(forwardBody);
    });
  })
  .listen(listen, '127.0.0.1', () => console.log(`tap ${listen} -> ${target}`));
