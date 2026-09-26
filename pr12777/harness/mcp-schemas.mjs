// A real stdio MCP server (official SDK). Each tool declares one of the failing-schema kinds named in
// PR 12777, plus controls. Every call the server receives is appended to $MCP_LOG: a received call
// with invalid arguments means the CLI skipped parameter validation.
import fs from 'node:fs';
const SDK = process.env.MCP_SDK;
const { Server } = await import(`${SDK}/server/index.js`);
const { StdioServerTransport } = await import(`${SDK}/server/stdio.js`);
const { ListToolsRequestSchema, CallToolRequestSchema } = await import(`${SDK}/types.js`);
const log = (o) => fs.appendFileSync(process.env.MCP_LOG, JSON.stringify(o) + '\n');
const count = { type: 'integer', minimum: 1 };
const TOOLS = {
  // unknown $schema (Ajv's draft-07 instance has no draft-04 meta-schema), with an $id
  d04_id: { $id: 'urn:p12777:d04', $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { count }, required: ['count'] },
  // the same without an $id (control: no $id to claim)
  d04_noid: { $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { count }, required: ['count'] },
  // unresolvable $ref, with an $id: never compiles
  badref_id: { $id: 'urn:p12777:badref', type: 'object', properties: { count: { $ref: '#/definitions/missing' } }, required: ['count'] },
  // meta-schema violation (minimum must be a number), with an $id
  meta_id: { $id: 'urn:p12777:meta', type: 'object', properties: { count: { type: 'integer', minimum: 'one' } }, required: ['count'] },
  // ambiguous nested $id, with a root $id: fails before the root $id is claimed
  nested_id: { $id: 'urn:p12777:nested', type: 'object', properties: { count, a: { $id: 'urn:p12777:n', type: 'integer' }, b: { $id: 'urn:p12777:n', type: 'string' } }, required: ['count'] },
  // two tools whose different schemas share one $id (a server that changed a schema but not its $id)
  dup_a: { $id: 'urn:p12777:dup', type: 'object', properties: { count }, required: ['count'] },
  dup_b: { $id: 'urn:p12777:dup', type: 'object', properties: { count: { type: 'integer', minimum: 5 } }, required: ['count'] },
  // compiling schema with an $id (control)
  ok_id: { $id: 'urn:p12777:ok', type: 'object', properties: { count }, required: ['count'] },
};
const server = new Server({ name: 'probe', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log({ event: 'listTools' });
  return { tools: Object.entries(TOOLS).map(([name, inputSchema]) => ({ name, description: `probe tool ${name}; count is an integer >= 1`, inputSchema })) };
});
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  log({ event: 'callTool', tool: req.params.name, args: req.params.arguments });
  return { content: [{ type: 'text', text: `server received ${JSON.stringify(req.params.arguments)}` }] };
});
await server.connect(new StdioServerTransport());
