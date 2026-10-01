// Matcher-level probe: real DiscoveredMCPTool producer + real PermissionManager.evaluate on each arm,
// head evaluated both WITHOUT and WITH the producer-carried mcpIdentity (production threads it).
import { pathToFileURL } from 'node:url';
const arm = (d) => ({
  mcp: `${d}/packages/core/dist/src/tools/mcp-tool.js`,
  pm: `${d}/packages/core/dist/src/permissions/permission-manager.js`,
});
const load = async (d) => ({
  ...(await import(pathToFileURL(arm(d).mcp).href)),
  ...(await import(pathToFileURL(arm(d).pm).href)),
});
const B = await load('/root/verify/pr12531/base');
const H = await load('/root/verify/pr12531/head');
const mk = (M, s, t) => new M.DiscoveredMCPTool({}, s, t, 'd', { type: 'object' });
const cfg = (allow, deny) => ({
  getPermissionsAllow: () => allow, getPermissionsAsk: () => [], getPermissionsDeny: () => deny,
  getProjectRoot: () => '/tmp', getCwd: () => '/tmp', getTargetDir: () => '/tmp',
  getWorkspaceContext: () => ({ getDirectories: () => ['/tmp'] }),
  getApprovalMode: () => 'default', getCoreTools: () => undefined, getExcludeTools: () => undefined,
});
async function ev(M, allow, deny, s, t, withIdentity) {
  const tool = mk(M, s, t);
  const pm = new M.PermissionManager(cfg(allow, deny));
  pm.initialize();
  const ctx = { toolName: tool.name, toolAliases: tool.permissionAliases };
  if (withIdentity) ctx.mcpIdentity = { serverName: s, serverToolName: t };
  return { name: tool.name, aliases: tool.permissionAliases, d: await pm.evaluate(ctx) };
}
const R142 = 'get+data_for_a_specific_location_and_date_range_extended';
const cells = [
  ['allow mcp__foo.bar → foo_bar/evil', ['mcp__foo.bar'], [], 'foo_bar', 'evil'],
  ['allow mcp__foo → foo_/x', ['mcp__foo'], [], 'foo_', 'x'],
  ['deny mcp__zybio_db → zybio.db/search_pubmed', [], ['mcp__zybio_db'], 'zybio.db', 'search_pubmed'],
  ['deny mcp__zybio_db__* → zybio.db/search_pubmed', [], ['mcp__zybio_db__*'], 'zybio.db', 'search_pubmed'],
  ['deny mcp__github__search_* → github/search.repos', [], ['mcp__github__search_*'], 'github', 'search.repos'],
  ['deny mcp__foo.bar__get_data_for_a_specific* → foo.bar/get+data…', [], ['mcp__foo.bar__get_data_for_a_specific*'], 'foo.bar', R142],
  ['deny mcp__foo_bar → foo:bar/a.b', [], ['mcp__foo_bar'], 'foo:bar', 'a.b'],
  ['deny mcp__foo_bar__a.b* (hybrid) → foo:bar/a.b', [], ['mcp__foo_bar__a.b*'], 'foo:bar', 'a.b'],
  ['deny mcp__zybio.db (raw, control) → zybio.db/search_pubmed', [], ['mcp__zybio.db'], 'zybio.db', 'search_pubmed'],
  ['allow mcp__* → github/create_issue', ['mcp__*'], [], 'github', 'create_issue'],
  ['deny mcp__* → github/create_issue', [], ['mcp__*'], 'github', 'create_issue'],
  ['deny mcp__git* → github/create_issue', [], ['mcp__git*'], 'github', 'create_issue'],
  ['deny mcp__github__* (control) → github/create_issue', [], ['mcp__github__*'], 'github', 'create_issue'],
  ['deny mcp__github__create_* (control) → github/create_issue', [], ['mcp__github__create_*'], 'github', 'create_issue'],
];
console.log('cell | registered | base | head(no identity) | head(+identity)');
for (const [label, allow, deny, s, t] of cells) {
  const b = await ev(B, allow, deny, s, t, false);
  const h0 = await ev(H, allow, deny, s, t, false);
  const h1 = await ev(H, allow, deny, s, t, true);
  console.log(`${label} | ${h1.name} | ${b.d} | ${h0.d} | ${h1.d}`);
}
