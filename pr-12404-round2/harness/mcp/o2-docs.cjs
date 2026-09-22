// Minimal stdio MCP server: no tools of interest, zero resources.
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  switch (msg.method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'o2-docs', version: '1.0.0' } } });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'o2_lookup', description: 'Look up an O2 doc', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] } });
    case 'tools/call':
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'o2 ok' }] } });
    case 'resources/list':
      return send({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } });
    case 'prompts/list':
      return send({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } });
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
