// Minimal stdio MCP server. argv[2] selects the tool set.
import { McpServer } from '/root/verify/pr12466-head/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { StdioServerTransport } from '/root/verify/pr12466-head/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { z } from '/root/verify/pr12466-head/node_modules/zod/index.js';
const kind = process.argv[2] ?? 'inventory';
const server = new McpServer({ name: kind, version: '1.0.0' });
if (kind === 'inventory') {
  server.tool('lookup_sku', 'Look up a SKU in the inventory', { sku: z.string(), include: z.array(z.string()).optional() }, async ({ sku, include }) => {
    await new Promise(r => setTimeout(r, 450));
    return { content: [{ type: 'text', text: JSON.stringify({ sku, name: 'Widget', price: { amount: 12.5, currency: 'USD' }, stock: { warehouse: 'HZ-1', units: 42 }, include: include ?? [] }) }] };
  });
} else {
  server.tool('describe_item', 'Describe a catalog item', { id: z.number() }, async ({ id }) => {
    await new Promise(r => setTimeout(r, 120));
    return { content: [{ type: 'text', text: JSON.stringify({ id, title: 'Catalog item', tags: ['alpha', 'beta'], dimensions: { w: 3, h: 4 } }) }] };
  });
}
await server.connect(new StdioServerTransport());
