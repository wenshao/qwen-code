// Fake QQ Bot Open Platform speaking the real protocol over real TLS.
//   HTTPS  <SPOOF_IP>:443  bots.qq.com/app/getAppAccessToken
//                          api.sgroup.qq.com/gateway  -> wss://api.sgroup.qq.com/websocket
//                          api.sgroup.qq.com/v2/{groups,users}/:id/messages (recorded)
//                          multimedia.nt.qq.com.cn/<name>.png[?delay=ms] (attachment bytes)
//   WSS    /websocket      HELLO -> IDENTIFY -> READY, HEARTBEAT/ACK, DISPATCH on demand
//   HTTP   127.0.0.1:<CTL> control plane for the driver: /dispatch /ledger /status /reset
'use strict';
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('/Users/cici/git/qwen-code-x6/tmp/pr13250-head/node_modules/ws');

const TLS_PORT = Number(process.env.QQ_FAKE_PORT || 18444);
const CTL_PORT = Number(process.env.QQ_CTL_PORT || 18443);
const LEDGER = process.env.QQ_LEDGER || path.join(__dirname, 'qq-ledger.jsonl');
const certDir = path.join(__dirname, 'certs');

let ledger = [];
let seq = 0;
let botMsgId = 0;
let tokenN = 0;
const clients = new Set();
const t0 = Date.now();

function record(entry) {
  const e = { ts: Date.now(), ...entry };
  ledger.push(e);
  fs.appendFileSync(LEDGER, JSON.stringify(e) + '\n');
}

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(certDir, 'leaf.key')),
    cert: fs.readFileSync(path.join(certDir, 'leaf.pem')),
  },
  async (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const url = new URL(req.url, `https://${host}`);
    const body = await readBody(req);
    if (host === 'bots.qq.com' && url.pathname === '/app/getAppAccessToken') {
      tokenN++;
      record({ kind: 'token', body: safeJson(body) });
      return json(res, 200, { access_token: `tok-${tokenN}`, expires_in: '7200' });
    }
    if (host === 'api.sgroup.qq.com' && url.pathname === '/gateway') {
      record({ kind: 'gateway', auth: req.headers.authorization });
      return json(res, 200, { url: 'wss://api.sgroup.qq.com/websocket' });
    }
    const m = url.pathname.match(/^\/v2\/(groups|users)\/([^/]+)\/messages$/);
    if (host === 'api.sgroup.qq.com' && m && req.method === 'POST') {
      const b = safeJson(body);
      const id = `bot-msg-${++botMsgId}`;
      record({ kind: 'send', chatType: m[1] === 'groups' ? 'group' : 'c2c', chatId: decodeURIComponent(m[2]), body: b, auth: req.headers.authorization, id });
      return json(res, 200, { id, timestamp: new Date().toISOString() });
    }
    if (host === 'multimedia.nt.qq.com.cn') {
      const delay = Number(url.searchParams.get('delay') || 0);
      record({ kind: 'media-get', path: url.pathname, delay });
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
        res.end(PNG);
      }, delay);
      return;
    }
    record({ kind: 'unhandled', host, method: req.method, path: url.pathname, body: safeJson(body) });
    json(res, 404, { message: 'not found' });
  },
);

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const host = String(req.headers.host || '').split(':')[0];
  if (host !== 'api.sgroup.qq.com' || !req.url.startsWith('/websocket')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  record({ kind: 'ws-open' });
  ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } }));
  ws.on('message', (data) => {
    const msg = safeJson(data.toString());
    if (msg.op === 2) {
      record({ kind: 'identify', intents: msg.d && msg.d.intents, token: msg.d && msg.d.token });
      clients.add(ws);
      ws.send(
        JSON.stringify({
          op: 0,
          s: ++seq,
          t: 'READY',
          d: { version: 1, session_id: `sess-${Date.now()}`, user: { id: 'BOT0001', username: 'qwen-bot', bot: true }, shard: [0, 1] },
        }),
      );
    } else if (msg.op === 6) {
      record({ kind: 'resume' });
      clients.add(ws);
      ws.send(JSON.stringify({ op: 0, s: ++seq, t: 'RESUMED', d: {} }));
    } else if (msg.op === 1) {
      ws.send(JSON.stringify({ op: 11 }));
    }
  });
  ws.on('close', (code) => {
    clients.delete(ws);
    record({ kind: 'ws-close', code });
  });
});

const ctl = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://ctl');
  const body = await readBody(req);
  if (url.pathname === '/dispatch' && req.method === 'POST') {
    const { t, d } = JSON.parse(body);
    const frame = JSON.stringify({ op: 0, s: ++seq, t, d });
    let n = 0;
    for (const ws of clients) {
      ws.send(frame);
      n++;
    }
    record({ kind: 'dispatch', t, id: d && d.id, chatId: d && (d.group_openid || (d.author && d.author.user_openid)), content: d && d.content });
    return json(res, 200, { sent: n });
  }
  if (url.pathname === '/ledger') return json(res, 200, ledger);
  if (url.pathname === '/status') return json(res, 200, { clients: clients.size, uptimeMs: Date.now() - t0 });
  if (url.pathname === '/reset') {
    ledger = [];
    return json(res, 200, { ok: true });
  }
  json(res, 404, {});
});

server.listen(TLS_PORT, '127.0.0.1', () => {
  ctl.listen(CTL_PORT, '127.0.0.1', () => {
    process.stdout.write(`FAKEQQ_READY https://127.0.0.1:${TLS_PORT} ctl=http://127.0.0.1:${CTL_PORT}\n`);
  });
});
