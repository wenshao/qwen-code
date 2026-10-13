// Round 3: a real stdio MCP server (SDK low-level Server) that the Runtime worker spawns.
// Every lifecycle event is appended to RIG_MCP_LOG with this process's pid/ppid.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const req = createRequire(process.env.RIG_SDK_FROM);
const { Server } = req('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = req('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = req('@modelcontextprotocol/sdk/types.js');
const log = (e) => fs.appendFileSync(process.env.RIG_MCP_LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ppid: process.ppid, server: process.env.RIG_MCP_NAME, ...e }) + '\n');
log({ ev: 'start', cwd: process.cwd() });
const server = new Server({ name: 'rig-stdio', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log({ ev: 'list' });
  return { tools: [{ name: 'rig_stdio_echo', description: `RIGSTDIO echo tool (${process.env.RIG_MCP_NAME})`, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] };
});
server.setRequestHandler(CallToolRequestSchema, async (r) => {
  log({ ev: 'call', name: r.params.name, args: r.params.arguments });
  return { content: [{ type: 'text', text: `stdio-echo:${r.params.arguments?.text}` }] };
});
process.stdin.on('end', () => log({ ev: 'stdin-end' }));
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { log({ ev: 'signal', signal: s }); process.exit(0); });
process.on('exit', (code) => log({ ev: 'exit', code }));
await server.connect(new StdioServerTransport());
