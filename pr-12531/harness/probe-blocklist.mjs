// disallowedTools / blocklist predicate (matchesToolPattern) as the agent gates call it, base vs head(+identity)
import { pathToFileURL } from 'node:url';
const imp = (d, f) => import(pathToFileURL(`${d}/packages/core/dist/src/${f}`).href);
const B = { ...(await imp('/root/verify/pr12531/base', 'permissions/rule-parser.js')), ...(await imp('/root/verify/pr12531/base', 'tools/mcp-tool.js')) };
const H = { ...(await imp('/root/verify/pr12531/head', 'permissions/rule-parser.js')), ...(await imp('/root/verify/pr12531/head', 'tools/mcp-tool.js')) };
const F = { ...(await imp('/root/verify/pr12531/fix', 'permissions/rule-parser.js')), ...(await imp('/root/verify/pr12531/fix', 'tools/mcp-tool.js')) };
const cases = [['mcp__*', 'github', 'create_issue'], ['mcp__zybio_db', 'zybio.db', 'search_pubmed'], ['mcp__github__search_*', 'github', 'search.repos'], ['mcp__foo', 'foo_', 'x'], ['mcp__foo.bar', 'foo_bar', 'evil']];
console.log('disallowedTools entry | tool | base | head(+identity) | patch(+identity)');
for (const [p, s, t] of cases) {
  const mk = (M) => new M.DiscoveredMCPTool({}, s, t, 'd', {});
  const tb = mk(B), th = mk(H), tf = mk(F);
  const id = { serverName: s, serverToolName: t };
  console.log(`${p} | ${s}/${t} | ${B.matchesToolPattern(p, tb.name, tb.permissionAliases)} | ${H.matchesToolPattern(p, th.name, th.permissionAliases, id)} | ${F.matchesToolPattern(p, tf.name, tf.permissionAliases, id)}`);
}
