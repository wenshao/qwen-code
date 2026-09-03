// Fake DingTalk open-API + stream gateway (PR #10893 edition).
// Zero network: /etc/hosts points api.dingtalk.com and oapi.dingtalk.com at
// 127.0.0.1 and the daemon trusts our CA via NODE_EXTRA_CA_CERTS.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CERTS = path.join(HERE, 'certs');
const LOG = process.env.GW_LOG || path.join(HERE, 'gw-requests.jsonl');
const WS_PORT = Number(process.env.GW_WS_PORT || 9443);
const CTL_PORT = Number(process.env.GW_CTL_PORT || 9099);
// Modes (comma separated, any combination):
//   upload-expired-once  first /media/upload after (re)setting the mode -> errcode 42001
//   upload-auth-fail     every /media/upload -> errcode 40014
//   upload-500           every /media/upload -> HTTP 500
//   upload-nomedia       /media/upload -> errcode 0 but no media_id
//   webhook-file-fail    /robot/send with msgtype=file -> errcode 300001
//   webhook-file-500     /robot/send with msgtype=file -> HTTP 500
//   group-nokey          groupMessages/send -> {} (no processQueryKey)
//   dm-nokey             oToMessages/batchSend -> {} (no processQueryKey)
//   group-400            groupMessages/send -> HTTP 400
let MODE = new Set((process.env.GW_MODE || '').split(',').filter(Boolean));
let uploadsSinceMode = 0;
let tokenSeq = 0;
let pqkSeq = 0;

let sockets = [];
function record(entry) {
  fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...entry }) + '\n');
}
function readBody(req) {
  return new Promise((resolve) => {
    const bufs = [];
    req.on('data', (c) => bufs.push(c));
    req.on('end', () => resolve(Buffer.concat(bufs)));
  });
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(body);
}
/** Minimal multipart/form-data parser: returns [{name, filename, contentType, size, sha256, head}] */
function parseMultipart(buf, contentType) {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + m[2]);
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    let start = pos + boundary.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing --
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = buf.subarray(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = buf.indexOf(boundary, bodyStart);
    if (next === -1) break;
    let bodyEnd = next;
    if (buf[bodyEnd - 2] === 0x0d && buf[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    const body = buf.subarray(bodyStart, bodyEnd);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    const ct = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1];
    parts.push({
      name,
      filename,
      contentType: ct,
      size: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      head: body.subarray(0, 48).toString('utf8'),
    });
    pos = next;
  }
  return parts;
}

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(CERTS, 'server.key')),
    cert: fs.readFileSync(path.join(CERTS, 'server.pem')),
  },
  async (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const raw = await readBody(req);
    const ct = String(req.headers['content-type'] || '');
    let body;
    let multipart;
    if (ct.startsWith('multipart/form-data')) {
      multipart = parseMultipart(raw, ct);
      body = { multipart };
    } else {
      const text = raw.toString('utf8');
      try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    }
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams.entries());
    const entry = { kind: 'http', method: req.method, host: req.headers.host, path: p, query: q, contentType: ct, bytes: raw.length, body };
    if (p === '/gettoken') {
      tokenSeq++;
      const tok = 'HARNESS_AT_' + tokenSeq;
      record({ ...entry, reply: { access_token: tok } });
      return json(res, 200, { errcode: 0, errmsg: 'ok', access_token: tok, expires_in: 7200 });
    }
    if (p === '/v1.0/oauth2/accessToken') { record(entry); return json(res, 200, { accessToken: 'HARNESS_AT_oauth', expireIn: 7200 }); }
    if (p === '/v1.0/gateway/connections/open') { record(entry); return json(res, 200, { endpoint: `ws://127.0.0.1:${WS_PORT}/connect`, ticket: 'HARNESS_TICKET' }); }
    if (p === '/media/upload') {
      uploadsSinceMode++;
      let reply;
      let status = 200;
      if (MODE.has('upload-expired-once') && uploadsSinceMode === 1) reply = { errcode: 42001, errmsg: 'access_token expired ' + q.access_token };
      else if (MODE.has('upload-auth-fail')) reply = { errcode: 40014, errmsg: 'invalid access_token ' + q.access_token };
      else if (MODE.has('upload-500')) { status = 500; reply = { errcode: -1, errmsg: 'system busy' }; }
      else if (MODE.has('upload-nomedia')) reply = { errcode: 0, errmsg: 'ok' };
      else {
        const f = multipart?.find((x) => x.filename) ?? multipart?.[0];
        reply = { errcode: 0, errmsg: 'ok', media_id: '@' + (q.type || 'x') + '-' + (f?.sha256?.slice(0, 12) || 'none'), created_at: Date.now(), type: q.type };
      }
      record({ ...entry, reply, status });
      return json(res, status, reply);
    }
    if (p === '/robot/send' || p.startsWith('/robot/')) {
      const isFile = body?.msgtype === 'file';
      let reply = { errcode: 0, errmsg: 'ok' };
      let status = 200;
      if (isFile && MODE.has('webhook-file-fail')) reply = { errcode: 300001, errmsg: 'file message rejected by harness' };
      if (isFile && MODE.has('webhook-file-500')) { status = 500; reply = { errcode: -1, errmsg: 'harness 500' }; }
      record({ ...entry, reply, status });
      return json(res, status, reply);
    }
    if (p === '/v1.0/robot/groupMessages/send') {
      let reply = { processQueryKey: 'pqk-g-' + ++pqkSeq };
      let status = 200;
      if (MODE.has('group-nokey')) reply = {};
      if (MODE.has('group-400')) { status = 400; reply = { code: 'invalidParameter', message: 'harness 400' }; }
      record({ ...entry, reply, status });
      return json(res, status, reply);
    }
    if (p === '/v1.0/robot/oToMessages/batchSend') {
      let reply = { processQueryKey: 'pqk-d-' + ++pqkSeq, invalidStaffIdList: [], flowControlledStaffIdList: [] };
      if (MODE.has('dm-nokey')) reply = { invalidStaffIdList: [], flowControlledStaffIdList: [] };
      record({ ...entry, reply });
      return json(res, 200, reply);
    }
    if (p === '/v1.0/card/instances/createAndDeliver') { record(entry); return json(res, 200, { result: { outTrackId: body?.outTrackId, deliverResults: [{ success: true }] } }); }
    if (p === '/v1.0/card/instances' || p === '/v1.0/card/streaming') { record(entry); return json(res, 200, { success: true }); }
    if (p.startsWith('/v1.0/robot/')) { record(entry); return json(res, 200, { processQueryKey: 'k' }); }
    record(entry);
    return json(res, 200, { errcode: 0, errmsg: 'ok(default)' });
  },
);
server.listen(443, '127.0.0.1', () => console.error('[gw] https :443'));

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
wss.on('connection', (ws) => {
  sockets.push(ws);
  console.error('[gw] ws client connected');
  const sys = (topic) => ws.send(JSON.stringify({ specVersion: '1.0', type: 'SYSTEM', headers: { topic, contentType: 'application/json', messageId: 'sys-' + topic, time: String(Date.now()) }, data: '{}' }));
  sys('CONNECTED');
  sys('REGISTERED');
  ws.on('message', (raw) => record({ kind: 'ws_up', text: String(raw) }));
  ws.on('close', () => { sockets = sockets.filter((s) => s !== ws); });
});
function push(topic, data) {
  const frame = { specVersion: '1.0', type: 'CALLBACK', headers: { topic, contentType: 'application/json', messageId: 'mid-' + Math.random().toString(36).slice(2), time: String(Date.now()) }, data: typeof data === 'string' ? data : JSON.stringify(data) };
  record({ kind: 'ws_down', topic, data });
  for (const s of sockets) s.send(JSON.stringify(frame));
  return sockets.length;
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/push') { const body = JSON.parse((await readBody(req)).toString('utf8')); return json(res, 200, { delivered: push(body.topic, body.data) }); }
  if (url.pathname === '/log') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''); }
  if (url.pathname === '/reset') { fs.writeFileSync(LOG, ''); return json(res, 200, { ok: true }); }
  if (url.pathname === '/ready') return json(res, 200, { clients: sockets.length, mode: [...MODE] });
  if (url.pathname === '/mode') { MODE = new Set((url.searchParams.get('m') || '').split(',').filter(Boolean)); uploadsSinceMode = 0; return json(res, 200, { mode: [...MODE] }); }
  return json(res, 404, {});
}).listen(CTL_PORT, '127.0.0.1', () => console.error('[gw] ctl :' + CTL_PORT));
