// VERIFICATION RIG ONLY (PR #13206): browser-side wire between vite's dev proxy and the Java server.
// Forwards every request unchanged, records them, and rewrites SSE frames of POST .../events/stream
// according to a rules file (re-read when it changes). The Java server itself never emits an
// unparseable frame (Jackson serializes every event), so a corrupt frame has to be made on the wire.
// usage: node wire.mjs <listen> <target> <log.jsonl> <rules.json>
// rules.json: array of
//   { "kind": "frame", "session"?: id, "contains"?: str, "event"?: name, "action": "corrupt"|"nonobject"|"nodata", "times"?: n }
//       corrupt   keep id:/event:, replace the data line with truncated JSON
//       nonobject keep id:/event:, replace the data line with a JSON string
//       nodata    keep id:/event:, drop the data line
//     absent "times" = persistent: the frame is corrupted every time it is served (a poisoned replay log)
//   { "kind": "prefix", "session"?: id, "frame": "<raw sse text>", "times"?: n }   injected first in each stream response
//   { "kind": "hold", "path": regex, "bodyContains"?: str, "ms": n, "times"?: n }   delay forwarding a request
// Control: POST /__wire/kill {"session": id}  -> destroys the open stream responses of that session.
import http from 'node:http';
import fs from 'node:fs';

const [listen, target, log, rulesFile] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
let rules = [];
let stamp = 0;
function loadRules() {
  try {
    const m = fs.statSync(rulesFile).mtimeMs;
    if (m !== stamp) {
      stamp = m;
      rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')).map((r) => ({ ...r, left: r.times ?? Infinity }));
    }
  } catch {
    rules = [];
    stamp = 0;
  }
}
const write = (e) => fs.appendFileSync(log, JSON.stringify({ t: Date.now(), ...e }) + '\n');
let nextReq = 1;
const streams = new Map(); // reqId -> { session, res, up }

function parseFrame(frame) {
  let id;
  let event;
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5));
  }
  return { id, event, data };
}

function rewrite(frame, session, reqId) {
  const { id, event, data } = parseFrame(frame);
  loadRules();
  const rule = rules.find(
    (r) =>
      r.kind === 'frame' &&
      r.left > 0 &&
      (!r.session || r.session === session) &&
      (!r.event || r.event === event) &&
      (!r.contains || frame.includes(r.contains)),
  );
  const isComment = !id && !event && data.length === 0;
  if (!isComment) write({ kind: 'frame', reqId, session, id: id ?? null, event: event ?? null, bytes: frame.length, action: rule?.action ?? null });
  if (!rule) return frame;
  rule.left -= 1;
  const head = frame.split(/\r?\n/).filter((l) => !l.startsWith('data:'));
  if (rule.action === 'corrupt') return [...head, 'data:{"schemaVersion":1,"sequence":' + (id ?? '0') + ',"type":"' + (event ?? '') + '","data":{"delta":"tru'].join('\n');
  if (rule.action === 'nonobject') return [...head, 'data:"corrupt frame"'].join('\n');
  if (rule.action === 'nodata') return head.join('\n');
  return frame;
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const reqId = nextReq++;
      if (req.url.startsWith('/__wire/kill')) {
        const { session } = JSON.parse(body.toString('utf8') || '{}');
        let killed = 0;
        for (const [id, s] of streams) {
          if (!session || s.session === session) {
            // An orderly end (what the server does on its stream timeout): vite's dev proxy does not
            // pass a destroyed upstream socket on to the browser, so a hard abort would never arrive.
            if (!s.res.headersSent) s.res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            s.res.end();
            s.res.once('finish', () => s.up?.destroy());
            streams.delete(id);
            killed++;
          }
        }
        write({ kind: 'kill', session, killed });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ killed }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {}
      const isStream = req.url.endsWith('/events/stream');
      const session = parsed?.sessionId;
      write({ kind: 'req', reqId, method: req.method, path: req.url, body: parsed ?? (body.length ? `<${body.length} bytes>` : undefined) });
      loadRules();
      const hold = rules.find((r) => r.kind === 'hold' && r.left > 0 && new RegExp(r.path).test(req.url) && (!r.bodyContains || body.toString('utf8').includes(r.bodyContains)));
      if (hold) {
        hold.left -= 1;
        write({ kind: 'hold', reqId, ms: hold.ms });
        await new Promise((r) => setTimeout(r, hold.ms));
      }
      let upstream;
      const prefix = isStream && rules.find((r) => r.kind === 'prefix' && r.left > 0 && (!r.session || r.session === session));
      if (prefix) {
        prefix.left -= 1;
        write({ kind: 'prefix', reqId, session });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(prefix.frame);
      }
      if (isStream) streams.set(reqId, { session, res, get up() { return upstream; } });
      upstream = http.request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } },
        (up) => {
          write({ kind: 'res', reqId, status: up.statusCode });
          if (!res.headersSent) res.writeHead(up.statusCode, up.headers);
          if (!isStream || up.statusCode !== 200) {
            up.pipe(res);
            return;
          }
          let buffer = '';
          up.setEncoding('utf8');
          up.on('data', (c) => {
            if (res.writableEnded) return;
            buffer += c;
            let m;
            while ((m = /\r?\n\r?\n/.exec(buffer))) {
              const frame = buffer.slice(0, m.index);
              buffer = buffer.slice(m.index + m[0].length);
              res.write(rewrite(frame, session, reqId) + '\n\n');
            }
          });
          up.on('end', () => {
            if (res.writableEnded) return;
            if (buffer) res.write(buffer);
            res.end();
            streams.delete(reqId);
            write({ kind: 'end', reqId, reason: 'upstream-end' });
          });
          // The server went away mid-stream: end the response in order, because vite's dev proxy would
          // swallow a destroyed socket and leave the browser on a dead stream.
          const gone = (why) => { if (res.writableEnded) return; if (buffer) res.write(buffer); res.end(); streams.delete(reqId); write({ kind: 'end', reqId, reason: why }); };
          up.on('aborted', () => gone('upstream-aborted'));
          up.on('error', () => gone('upstream-error'));
        },
      );
      upstream.on('error', (e) => {
        write({ kind: 'error', reqId, error: String(e) });
        res.destroy();
      });
      res.on('close', () => {
        if (streams.has(reqId)) {
          streams.delete(reqId);
          write({ kind: 'end', reqId, reason: 'client-close' });
        }
        upstream.destroy();
      });
      upstream.end(body);
    });
  })
  .listen(listen, '127.0.0.1', () => console.log(`wire listening ${listen} -> ${target}`));
