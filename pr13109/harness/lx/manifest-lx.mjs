// manifest-lx.mjs <run-dir> <workspaces>  -- MCP definitions for the container rig
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const [run, n] = process.argv.slice(2);
const d = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const servers = [];
for (let w = 0; w < Number(n); w++) {
  const ws = `workspace-${w}`;
  const stdio = { tenantId: 't-rig', workspaceId: ws, serverId: 'local', serverRevision: 1, transport: 'stdio',
    command: '/usr/local/bin/node', args: ['/rig/mcp-server.mjs', '--transport', 'stdio', '--name', `stdio-${w}`, '--ledger', `${run}/ledger.jsonl`],
    env: { MCP_TOKEN: 'stdio-secret-token' } };
  const http = { tenantId: 't-rig', workspaceId: ws, serverId: 'remote', serverRevision: 1, transport: 'streamable-http',
    url: 'http://127.0.0.1:18811/mcp', headers: { Authorization: 'Bearer http-secret-token' } };
  const plain = { tenantId: 't-rig', workspaceId: ws, serverId: 'plain', serverRevision: 1, transport: 'streamable-http', url: 'http://127.0.0.1:18813/mcp' };
  for (const x of [stdio, http, plain]) servers.push({ ...x, definitionDigest: d(x) });
}
writeFileSync(`${run}/manifest.json`, JSON.stringify({ version: 1, servers }, null, 1));
