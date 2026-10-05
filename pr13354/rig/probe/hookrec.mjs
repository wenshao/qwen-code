// VERIFICATION RIG ONLY (PR #13354): HTTP Hook endpoint recorder. Every request -> one JSON line; answers {} 200.
// usage: node hookrec.mjs <port> <log.jsonl>
import http from 'node:http';
import fs from 'node:fs';
const [port, log] = [Number(process.argv[2]), process.argv[3]];
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body; try { body = JSON.parse(raw); } catch { body = raw.slice(0, 200); }
    fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), path: req.url, session: body?.session_id, event: body?.hook_event_name, deleted: body?.deleted_session_id, reason: body?.reason }) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
  });
}).listen(port, '127.0.0.1', () => console.log(`hookrec listening ${port}`));
