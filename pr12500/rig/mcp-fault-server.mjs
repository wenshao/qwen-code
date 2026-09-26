// Configurable fault MCP server for PR #12500. One process serves a whole status matrix:
// every MCP server entry in settings.json points at the same port with a different query string.
//
//   Streamable HTTP : POST/GET  /mcp?fault=<status>&kind=<kind>[&get=<status>]
//   legacy SSE      : GET /sse?fault=..&kind=..  -> "endpoint" event -> POST /messages?sid=..&fault=..&kind=..
//
// initialize / notifications/initialized / tools/list / tools/call succeed (tools-only server,
// capabilities: { tools }). Every other method (prompts/list, resources/list, ping, ...) is answered
// with HTTP <fault> and a body chosen by <kind>. fault=200 answers in-band (control row).
// `get` sets the status of the optional Streamable HTTP GET SSE stream (default 405).
// POST /__control {"mode":"normal"|"nginx502"|"reset"} simulates an outage for every route.
import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 0);
const LEDGER = process.env.LEDGER;
let mode = 'normal';

const log = (entry) => {
  if (LEDGER) fs.appendFileSync(LEDGER, JSON.stringify({ t: new Date().toISOString(), mode, ...entry }) + '\n');
};

const BODIES = {
  m32601: (m, id) => JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found', data: { method: m } }, id }),
  // alternate wording some servers use; PR's predicate keys on the numeric code, not on the text
  m32601alt: (m, id) => JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: `Unknown method: ${m}` }, id }),
  m32001: () => JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }),
  m32603: (m, id) => JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id }),
  nojsonrpc: (m, id) => JSON.stringify({ error: { code: -32601, message: 'Method not found' }, id }),
  html: () => '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>',
  quote: (m, id) => `upstream error: last upstream reply was {"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":${id}}; upstream now unreachable`,
  plain: () => 'Method not found',
};
const TYPES = { html: 'text/html', quote: 'text/plain', plain: 'text/plain' };

const TOOLS = [{ name: 'probe', description: 'Returns a fixed marker string.', inputSchema: { type: 'object', properties: {}, required: [] } }];

// returns { status, body, ctype } or { result } for in-band success
function handle(q, msg) {
  const { method, id, params = {} } = msg;
  switch (method) {
    case 'initialize':
      return {
        result: {
          protocolVersion: q.get('proto') || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'pr12500-fault-server', version: '1.0.0' },
        },
      };
    case 'notifications/initialized':
      return { accepted: true };
    case 'tools/list':
      return { result: { tools: TOOLS } };
    case 'tools/call':
      return { result: { content: [{ type: 'text', text: `PROBE-OK fault=${q.get('fault')} kind=${q.get('kind')}` }], isError: false } };
  }
  if (method === undefined) return { accepted: true }; // a response / notification from the client
  if (id === undefined) return { accepted: true };
  const fault = Number(q.get('fault') || 404);
  if (fault === 200) {
    if (method === 'prompts/list') return { result: { prompts: [] } };
    if (method === 'resources/list') return { result: { resources: [] } };
    return { result: {} };
  }
  const kind = q.get('kind') || 'm32601';
  return { status: fault, body: BODIES[kind](method, id), ctype: TYPES[kind] || 'application/json' };
}

const sseSessions = new Map(); // sid -> res

function outage(req, res, route) {
  if (mode === 'nginx502') {
    log({ route, http: req.method, status: 502, outage: true });
    res.writeHead(502, { 'content-type': 'text/html' });
    res.end(BODIES.html());
    return true;
  }
  if (mode === 'reset') {
    log({ route, http: req.method, outage: 'reset' });
    req.socket.destroy();
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams;
  const route = `${url.pathname}?${[...q].filter(([k]) => k !== 'sid').map(([k, v]) => `${k}=${v}`).join('&')}`;
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (url.pathname === '/__control' && req.method === 'POST') {
      mode = JSON.parse(raw).mode;
      log({ control: mode });
      if (mode !== 'normal') for (const s of sseSessions.values()) s.destroy?.();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ mode }));
    }

    // ---------------- Streamable HTTP ----------------
    if (url.pathname === '/mcp') {
      if (outage(req, res, route)) return;
      if (req.method === 'GET') {
        const st = Number(q.get('get') || 405);
        log({ route, http: 'GET', status: st });
        res.writeHead(st, { 'content-type': 'application/json' });
        return res.end(st === 405 ? '' : JSON.stringify({ error: `GET not supported (${st})` }));
      }
      if (req.method === 'DELETE') {
        log({ route, http: 'DELETE', status: 405 });
        res.writeHead(405);
        return res.end();
      }
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        res.writeHead(400);
        return res.end('bad json');
      }
      const out = handle(q, msg);
      if (out.accepted) {
        log({ route, http: 'POST', rpc: msg.method, status: 202 });
        res.writeHead(202);
        return res.end();
      }
      if (out.result) {
        log({ route, http: 'POST', rpc: msg.method, id: msg.id, status: 200 });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', result: out.result, id: msg.id }));
      }
      log({ route, http: 'POST', rpc: msg.method, id: msg.id, status: out.status, kind: q.get('kind') });
      res.writeHead(out.status, { 'content-type': out.ctype });
      return res.end(out.body);
    }

    // ---------------- legacy SSE (2024-11-05 transport) ----------------
    if (url.pathname === '/sse' && req.method === 'GET') {
      if (outage(req, res, route)) return;
      const sid = randomUUID();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const qs = new URLSearchParams(q);
      qs.set('sid', sid);
      res.write(`event: endpoint\ndata: /messages?${qs}\n\n`);
      sseSessions.set(sid, res);
      log({ route, http: 'GET', sse: 'open', sid });
      res.on('close', () => sseSessions.delete(sid));
      return;
    }
    if (url.pathname === '/messages' && req.method === 'POST') {
      if (outage(req, res, route)) return;
      const stream = sseSessions.get(q.get('sid'));
      if (!stream) {
        log({ route, http: 'POST', status: 404, reason: 'no sse session' });
        res.writeHead(404);
        return res.end('Session not found');
      }
      const msg = JSON.parse(raw);
      const out = handle(q, msg);
      if (out.status) {
        // a legacy server/gateway that rejects the POST itself instead of replying on the stream
        log({ route, http: 'POST', rpc: msg.method, id: msg.id, status: out.status, kind: q.get('kind') });
        res.writeHead(out.status, { 'content-type': out.ctype });
        return res.end(out.body);
      }
      log({ route, http: 'POST', rpc: msg.method, id: msg.id, status: 202 });
      res.writeHead(202);
      res.end('Accepted');
      if (out.result) stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', result: out.result, id: msg.id })}\n\n`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`pr12500-fault-server listening ${port}`);
  if (process.env.PORT_FILE) fs.writeFileSync(process.env.PORT_FILE, String(port));
});
