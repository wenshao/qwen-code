// Round 3: a real streamable-HTTP MCP server (SDK low-level Server + StreamableHTTPServerTransport, one
// transport per MCP session) inside the rig process. Every HTTP exchange and transport close is logged.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

export async function startMcpHttp(ctx, sdkFrom) {
  const req = createRequire(sdkFrom);
  const { Server } = req('@modelcontextprotocol/sdk/server/index.js');
  const { StreamableHTTPServerTransport } = req('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } = req('@modelcontextprotocol/sdk/types.js');
  const logFile = `${ctx.runDir}/mcp-http.jsonl`;
  const events = [];
  const log = (e) => { const x = { t: new Date().toISOString(), ...e }; events.push(x); fs.appendFileSync(logFile, JSON.stringify(x) + '\n'); };
  const transports = new Map();
  const make = () => {
    const s = new Server({ name: 'rig-http', version: '1.0.0' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'rig_http_echo', description: 'RIGHTTP echo tool', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }));
    s.setRequestHandler(CallToolRequestSchema, async (r) => { log({ ev: 'call', name: r.params.name, args: r.params.arguments }); return { content: [{ type: 'text', text: `http-echo:${r.params.arguments?.text}` }] }; });
    return s;
  };
  const server = createServer((hreq, hres) => {
    const chunks = [];
    hreq.on('data', (c) => chunks.push(c));
    hreq.on('end', async () => {
      let body;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; } catch {}
      const sid = hreq.headers['mcp-session-id'];
      const rpc = Array.isArray(body) ? body.map((b) => b.method ?? 'response') : body?.method ?? null;
      log({ ev: 'http', method: hreq.method, sid: sid ? String(sid).slice(0, 8) : null, rpc });
      if (hreq.method === 'GET') hres.on('close', () => log({ ev: 'sse-closed', sid: sid ? String(sid).slice(0, 8) : null }));
      try {
        let t = sid ? transports.get(String(sid)) : undefined;
        if (!t) {
          if (hreq.method === 'POST' && body && !Array.isArray(body) && isInitializeRequest(body)) {
            t = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id) => { transports.set(id, t); log({ ev: 'session-init', sid: id.slice(0, 8) }); },
            });
            t.onclose = () => { log({ ev: 'transport-close', sid: t.sessionId?.slice(0, 8) ?? null }); if (t.sessionId) transports.delete(t.sessionId); };
            await make().connect(t);
          } else {
            hres.writeHead(sid ? 404 : 400, { 'content-type': 'application/json' });
            hres.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: sid ? 'Session not found' : 'No session' }, id: null }));
            return;
          }
        }
        await t.handleRequest(hreq, hres, body);
      } catch (e) {
        log({ ev: 'error', message: String(e?.message ?? e) });
        try { hres.writeHead(500).end(); } catch {}
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { server, port, url: `http://127.0.0.1:${port}/mcp`, events, live: () => [...transports.keys()].map((k) => k.slice(0, 8)) };
}
