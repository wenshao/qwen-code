// Fake DingTalk OpenAPI (https :443 via /etc/hosts + NODE_EXTRA_CA_CERTS) and
// Stream gateway (ws). Every API request is appended to $LOGS/api.jsonl.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const LOGS = process.env.DT_LOGS || path.join(ROOT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const apiLog = path.join(LOGS, 'api.jsonl');
const WS_PORT = Number(process.env.DT_WS_PORT || 28080);
const CTRL_PORT = Number(process.env.DT_CTRL_PORT || 28081);

const append = (file, obj) => fs.appendFileSync(file, JSON.stringify({ t: Date.now(), ...obj }) + '\n');
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

const apiServer = https.createServer(
  { key: fs.readFileSync(path.join(ROOT, 'certs/leaf.key')), cert: fs.readFileSync(path.join(ROOT, 'certs/leaf.crt')) },
  async (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const body = await readBody(req);
    let parsed; try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = body; }
    append(apiLog, { host: req.headers.host, method: req.method, path: url.pathname, query: url.search, body: parsed });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj ?? {})); };
    if (url.pathname === '/gettoken') return send(200, { errcode: 0, errmsg: 'ok', access_token: 'harness-token', expires_in: 7200 });
    if (url.pathname === '/v1.0/oauth2/accessToken') return send(200, { accessToken: 'harness-token', expireIn: 7200 });
    if (url.pathname === '/v1.0/gateway/connections/open') return send(200, { endpoint: `ws://127.0.0.1:${WS_PORT}`, ticket: 'harness-ticket' });
    if (url.pathname.startsWith('/v1.0/card/')) return send(200, { success: true, result: { outTrackId: parsed?.outTrackId ?? 'ot' } });
    if (url.pathname.startsWith('/v1.0/robot/') || url.pathname.startsWith('/robot/')) return send(200, { errcode: 0, errmsg: 'ok', processQueryKey: 'pqk-1' });
    return send(200, { errcode: 0, errmsg: 'ok' });
  },
);
apiServer.listen(443, '127.0.0.1', () => console.log('[fake-dingtalk] https 127.0.0.1:443'));

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
const sockets = new Set();
wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.send(JSON.stringify({ type: 'SYSTEM', headers: { topic: 'CONNECTED', messageId: 'sys-connected', contentType: 'application/json' }, data: '{}' }));
  ws.send(JSON.stringify({ type: 'SYSTEM', headers: { topic: 'REGISTERED', messageId: 'sys-registered', contentType: 'application/json' }, data: '{}' }));
  ws.on('close', () => sockets.delete(ws));
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const body = await readBody(req);
  if (url.pathname === '/push') {
    const data = JSON.parse(body);
    const frame = JSON.stringify({ type: 'CALLBACK', headers: { topic: '/v1.0/im/bot/messages/get', messageId: `push-${data.msgId}`, contentType: 'application/json' }, data: JSON.stringify(data) });
    let n = 0; for (const ws of sockets) if (ws.readyState === 1) { ws.send(frame); n++; }
    res.writeHead(200); return res.end(JSON.stringify({ delivered: n }));
  }
  if (url.pathname === '/clients') { res.writeHead(200); return res.end(JSON.stringify({ clients: sockets.size })); }
  res.writeHead(404); res.end('{}');
}).listen(CTRL_PORT, '127.0.0.1', () => console.log(`[fake-dingtalk] control http://127.0.0.1:${CTRL_PORT}`));
