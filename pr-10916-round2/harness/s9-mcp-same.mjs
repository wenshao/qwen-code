// S9-same — R11-1 end to end: a real stdio MCP server (mcp-upstream.mjs, mode "same"),
// three rounds calling mcp__upstream__fetch_upstream against three different targets,
// successful reads in between.
const WS = process.env.WS;
const plan = [
  { mcp: { method: 'GET', path: '/orders' } },
  { read: 'README.md' },
  { mcp: { method: 'GET', path: '/inventory' } },
  { glob: '*.md' },
  { mcp: { method: 'POST', path: '/checkout' } },
  { read: 'README.md' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'SUMMARY: orders, inventory and checkout each failed upstream; reported the three failures.' };
  const id = `call_s9_${step}`;
  if (p.mcp) return { toolCalls: [{ id, name: 'mcp__upstream__fetch_upstream', args: p.mcp }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
  if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
}
