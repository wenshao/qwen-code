// Gateway-style stdio MCP server for PR #10916 R11-1. Tool fetch_upstream{method,path}
// always fails (isError) and echoes the upstream exchange, as HTTP-proxy MCP servers do.
// argv: <mode> <hitsFile>; mode "distinct": the error names the request, so each
// target fails differently but every message ends in the same "... with response: 502 Bad Gateway".
// mode "same": every target fails with one byte-identical payload (a real dead end).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
const [mode, hitsFile] = process.argv.slice(2);
const server = new Server({ name: 'upstream-gateway', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'fetch_upstream', description: 'Proxy one HTTP request to the upstream service',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' } }, required: ['method', 'path'] } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { method = 'GET', path = '/' } = req.params.arguments ?? {};
  const text = mode === 'same'
    ? 'upstream unreachable: connect ECONNREFUSED 10.0.0.7:443'
    : `upstream ${method} ${path} failed with response: 502 Bad Gateway`;
  fs.appendFileSync(hitsFile, JSON.stringify({ tool: req.params.name, method, path, text, at: new Date().toISOString() }) + '\n');
  return { isError: true, content: [{ type: 'text', text }] };
});
await server.connect(new StdioServerTransport());
