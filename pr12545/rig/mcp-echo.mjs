// Minimal stdio MCP server: one tool `ping` that reports a counter and this pid.
const SDK = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/7bc698b0-90bd-485c-a8ac-90247e63fd5c/scratchpad/wt-head/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { McpServer } = await import(`${SDK}/server/mcp.js`);
const { StdioServerTransport } = await import(`${SDK}/server/stdio.js`);
let n = 0;
const server = new McpServer({ name: 'echo', version: '1.0.0' });
server.tool('ping', 'Returns pong with a call counter and the server pid.', async () => ({
  content: [{ type: 'text', text: `PONG-${++n} pid=${process.pid}` }],
}));
await server.connect(new StdioServerTransport());
