// A real stdio MCP server. `lookup04` declares a draft-04 input schema with an $id, which Ajv's
// draft-07 instance cannot compile on first use; `lookup04_noid` is the same schema without $id.
// Every call the server receives is appended to $MCP_LOG.
import fs from 'node:fs';
const SDK = process.env.MCP_SDK;
const { Server } = await import(`${SDK}/server/index.js`);
const { StdioServerTransport } = await import(`${SDK}/server/stdio.js`);
const { ListToolsRequestSchema, CallToolRequestSchema } = await import(`${SDK}/types.js`);
const log = (o) => fs.appendFileSync(process.env.MCP_LOG, JSON.stringify({ pid: process.pid, ...o }) + '\n');
const schema = (withId) => ({
  ...(withId ? { $id: 'urn:probe:lookup04-input' } : {}),
  $schema: 'http://json-schema.org/draft-04/schema#',
  type: 'object',
  properties: { count: { type: 'integer', minimum: 1 } },
  required: ['count'],
});
const server = new Server({ name: 'probe', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log({ event: 'listTools' });
  return { tools: [
    { name: 'lookup04', description: 'Look up `count` records (integer >= 1).', inputSchema: schema(true) },
    { name: 'lookup04_noid', description: 'Same, schema without $id.', inputSchema: schema(false) },
  ] };
});
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  log({ event: 'callTool', tool: req.params.name, args: req.params.arguments });
  return { content: [{ type: 'text', text: `server received ${JSON.stringify(req.params.arguments)}` }] };
});
await server.connect(new StdioServerTransport());
