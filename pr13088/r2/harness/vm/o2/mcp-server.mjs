// VERIFICATION RIG ONLY (PR #13088): a minimal real stdio MCP server (newline-delimited JSON-RPC) with one tool and one slow resource.
// Every tools/call appends a line to ./mcp-calls.log in the Session directory, so repeated effects are countable.
import fs from 'node:fs';
import readline from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  const { id, method, params } = m;
  if (method === 'initialize') return send({ id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'rig-mcp', version: '1' } } });
  if (method === 'tools/list') return send({ id, result: { tools: [{ name: 'echo', description: 'rig echo tool', inputSchema: { type: 'object', properties: { text: { type: 'string' }, waitMs: { type: 'number' } }, required: ['text'] } }] } });
  if (method === 'resources/list') return send({ id, result: { resources: [100, 20000].map((ms) => ({ uri: `rig://slow/${ms}`, name: `slow-${ms}` })) } });
  if (method === 'prompts/list') return send({ id, result: { prompts: [] } });
  if (method === 'tools/call') {
    fs.appendFileSync('mcp-calls.log', `${new Date().toISOString()} ${JSON.stringify(params?.arguments ?? {})}\n`);
    const n = fs.readFileSync('mcp-calls.log', 'utf8').split('\n').filter(Boolean).length;
    if (params?.arguments?.waitMs) await sleep(Number(params.arguments.waitMs));
    return send({ id, result: { content: [{ type: 'text', text: `echo:${params?.arguments?.text} calls=${n}` }] } });
  }
  if (method === 'resources/read') {
    const ms = Number(String(params?.uri ?? '').split('/').pop()) || 0;
    fs.appendFileSync('mcp-reads.log', `${new Date().toISOString()} ${params?.uri}\n`);
    await sleep(ms);
    return send({ id, result: { contents: [{ uri: params?.uri, mimeType: 'text/plain', text: `slow resource after ${ms} ms` }] } });
  }
  return send({ id, error: { code: -32601, message: 'Method not found' } });
});
