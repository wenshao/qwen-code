// Replica of GitLab 19.4 built-in MCP endpoint (lib/api/mcp/base.rb @ v19.4.0-ee)
// - POST /api/v4/mcp: initialize, notifications/initialized, tools/list, tools/call
// - any other method -> HTTP 404 + {"jsonrpc":"2.0","error":{"code":-32601,...,"data":{"method":m}},"id":id}
// - unknown tool in tools/call -> ArgumentError -> HTTP 400 -32602
// - GET -> 405, no Mcp-Session-Id header ever issued
// Every request is appended to LEDGER (jsonl). POST /__control {"mode":...} switches fault modes.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 0);
const LEDGER = process.env.LEDGER;
const TOKEN = process.env.TOKEN || 'glpat-fake-token';
let mode = 'normal';

const HANDSHAKE = ['2025-11-25', '2025-06-18', '2025-03-26'];
const STATELESS = ['2026-07-28'];
const TOOLS = [
  {
    name: 'get_mcp_server_version',
    description: 'Get the current version of MCP server.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_user',
    description: 'Get the currently authenticated user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function log(entry) {
  const line = JSON.stringify({ t: new Date().toISOString(), mode, ...entry });
  if (LEDGER) fs.appendFileSync(LEDGER, line + '\n');
}

function send(res, status, body, type = 'application/json') {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, text ? { 'content-type': type } : {});
  res.end(text);
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/__control' && req.method === 'POST') {
      mode = JSON.parse(raw).mode;
      log({ control: mode });
      return send(res, 200, { mode });
    }
    if (!req.url.startsWith('/api/v4/mcp')) return send(res, 404, { message: '404 Not Found' });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      log({ http: req.method, status: 401 });
      return send(res, 401, { message: '401 Unauthorized' });
    }
    if (req.method === 'GET') {
      log({ http: 'GET', status: 405 });
      return send(res, 405, 'null');
    }
    if (req.method !== 'POST') {
      log({ http: req.method, status: 405 });
      return send(res, 405, { error: '405 Not Allowed' });
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      log({ http: 'POST', status: 400, parse: false });
      return send(res, 400, 'Bad Request', 'text/plain');
    }
    const { method, id, params = {} } = msg;

    // ---- fault modes (simulate an outage mid-session) ----
    if (mode === 'nginx502') {
      log({ http: 'POST', rpc: method, id, status: 502 });
      return send(res, 502, '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>', 'text/html');
    }
    if (mode === 'proxy502-quoting') {
      // Bot R1-1 vector: a gateway error page that quotes an upstream JSON-RPC -32601 payload unescaped.
      log({ http: 'POST', rpc: method, id, status: 502 });
      return send(res, 502, `upstream error: last upstream reply was {"jsonrpc":"2.0","error":{"code": -32601,"message":"Method not found"},"id":7}; upstream now unreachable`, 'text/plain');
    }

    const reply = (result) => {
      if (id === undefined || id === null || result == null) {
        log({ http: 'POST', rpc: method, id, status: 202 });
        return send(res, 202);
      }
      log({ http: 'POST', rpc: method, id, status: 200, ...(method === 'initialize' ? { clientProtocol: params.protocolVersion } : {}) });
      return send(res, 200, { jsonrpc: '2.0', result, id });
    };
    const rpcError = (status, code, message, data) => {
      log({ http: 'POST', rpc: method, id, status, code });
      return send(res, status, { jsonrpc: '2.0', error: { code, message, data }, id });
    };

    switch (method) {
      case 'initialize': {
        const v = params.protocolVersion;
        if (!v) return rpcError(400, -32602, 'Invalid params', { params: "Missing required parameter 'protocolVersion'." });
        if (![...STATELESS, ...HANDSHAKE].includes(v))
          return rpcError(400, -32602, 'Invalid params', { params: `Unsupported protocol version '${v}'.` });
        return reply({
          protocolVersion: HANDSHAKE.includes(v) ? v : '2025-11-25',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'Official GitLab MCP Server', version: '19.4.0-replica' },
        });
      }
      case 'notifications/initialized':
        return reply(null);
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = params.name;
        if (name === 'get_mcp_server_version')
          return reply({ content: [{ type: 'text', text: '19.4.0-replica' }], isError: false });
        if (name === 'get_user')
          return reply({ content: [{ type: 'text', text: '{"username":"verifier","id":42}' }], isError: false });
        return rpcError(400, -32602, 'Invalid params', { params: `Tool '${name}' not found.` });
      }
      default:
        // lib/api/mcp/base.rb method_not_found!: render_structured_api_error!(..., 404)
        return rpcError(404, -32601, 'Method not found', { method });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`gitlab-mcp-fake listening ${port}`);
  if (process.env.PORT_FILE) fs.writeFileSync(process.env.PORT_FILE, String(port));
});
