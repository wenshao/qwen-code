// Minimal stdio MCP server for PR #12531 verification.
// argv: <label> <hitsFile> <tool...>; every tools/call appends one JSON line to hitsFile.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';

const [label, hitsFile, ...tools] = process.argv.slice(2);
const server = new Server(
  { name: `verify-${label}`, version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t,
    description: `verification tool ${t} on server ${label}`,
    inputSchema: { type: 'object', properties: {} },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  fs.appendFileSync(
    hitsFile,
    JSON.stringify({ server: label, tool: req.params.name, at: new Date().toISOString() }) + '\n',
  );
  return { content: [{ type: 'text', text: `EXECUTED ${label}/${req.params.name}` }] };
});
await server.connect(new StdioServerTransport());
