// A real stdio MCP server whose `lookup` tool schema carries `$id` (and `lookup_plain` without, as control).
// Every call it receives is appended to $MCP_LOG, with this server process's pid.
import fs from 'node:fs';
const SDK = process.env.MCP_SDK; // <repo>/node_modules/@modelcontextprotocol/sdk/dist/esm
const { Server } = await import(`${SDK}/server/index.js`);
const { StdioServerTransport } = await import(`${SDK}/server/stdio.js`);
const { ListToolsRequestSchema, CallToolRequestSchema } = await import(`${SDK}/types.js`);
const log = (o) => fs.appendFileSync(process.env.MCP_LOG, JSON.stringify({ pid: process.pid, ...o }) + '\n');
const schema = (withId) => ({
  ...(withId ? { $id: 'urn:probe:lookup-input' } : {}),
  type: 'object',
  properties: { count: { type: 'integer', minimum: 1 } },
  required: ['count'],
  additionalProperties: false,
});
const server = new Server({ name: 'probe', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log({ event: 'listTools' });
  return {
    tools: [
      { name: 'lookup', description: 'Look up `count` records. count must be an integer >= 1.', inputSchema: schema(true) },
      { name: 'lookup_plain', description: 'Same as lookup, schema without $id.', inputSchema: schema(false) },
    ],
  };
});
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  log({ event: 'callTool', tool: req.params.name, args: req.params.arguments });
  return { content: [{ type: 'text', text: `server received ${JSON.stringify(req.params.arguments)}` }] };
});
log({ event: 'start' });
await server.connect(new StdioServerTransport());
