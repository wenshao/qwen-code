// VERIFICATION RIG ONLY (PR #13138 round 3): deployment Hook manifest (QWEN_MANAGED_HOOK_CONFIG) and MCP manifest
// (QWEN_MANAGED_MCP_CONFIG) for the merged-tree scenarios. Writes /var/lib/qwen-w1b/{hooks,mcp-manifest}.json.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { TENANT, MCP_DIGEST } from './lib.mjs';
const HANDLERS = '/Users/wenshao/pr13138-rig/vm/hook-handlers.mjs';
const fn = (hookId, eventName, exportName, o = {}) => ({
  hookId, eventName, ...(o.matcher ? { matcher: o.matcher } : {}), sequential: false, onceKey: null, failClosed: false, async: false,
  config: { type: 'function', timeout: 20000 },
  handler: { handlerId: `h-${hookId}`, handlerRevision: 1, modulePath: HANDLERS, exportName },
});
export const HOOK_WS = ['ws-a1', 'ws-h1'];
const hooks = [fn('ups', 'UserPromptSubmit', 'ups'), fn('pre', 'PreToolUse', 'pre', { matcher: 'write_file' })];
const digest = createHash('sha256').update(JSON.stringify(hooks)).digest('hex');
export const hookPin = (ws) => ({ catalogId: `cat-${ws}`, catalogRevision: 1, definitionDigest: digest });
export const MCP_WS = ['ws-c1'];
if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = { version: 1, catalogs: HOOK_WS.map((workspaceId) => ({ tenantId: TENANT, workspaceId, catalogId: `cat-${workspaceId}`, catalogRevision: 1, definitionDigest: digest, hooks })) };
  fs.writeFileSync('/var/lib/qwen-w1b/hooks.json', JSON.stringify(manifest, null, 1));
  const mcp = { version: 1, servers: MCP_WS.map((workspaceId) => ({ tenantId: TENANT, workspaceId, serverId: 'demo', serverRevision: 1, definitionDigest: MCP_DIGEST, transport: 'stdio', command: '/opt/qwen/node', args: ['/opt/w1a/o2/mcp-server.mjs'] })) };
  fs.writeFileSync('/var/lib/qwen-w1b/mcp-manifest.json', JSON.stringify(mcp, null, 1));
  console.log(`hooks: ${manifest.catalogs.length} catalogs digest=${digest.slice(0, 12)}; mcp: ${mcp.servers.length} servers`);
}
