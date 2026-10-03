// Matcher-level sweep for R18-1: for budget-cut registrations, which wildcard prefixes
// `registered[:L] + '*'` still restrict / grant, per arm, through the real producer
// (DiscoveredMCPTool) and PermissionManager.evaluate with the producer identity.
// usage: node probe-r18.mjs base head candA candC
import { pathToFileURL } from 'node:url';
import { ARMS } from './scenarios.mjs';

const arms = process.argv.slice(2);
const imp = (arm, p) => import(pathToFileURL(`${ARMS[arm]}/packages/core/dist/src/${p}`).href);
const mods = {};
for (const arm of arms) {
  mods[arm] = { ...(await imp(arm, 'permissions/permission-manager.js')), ...(await imp(arm, 'tools/mcp-tool.js')) };
}
const callable = { callTool: async () => [] };
const cfg = (o) => ({
  getPermissionsAllow: () => o.allow, getPermissionsAsk: () => o.ask, getPermissionsDeny: () => o.deny,
  getProjectRoot: () => '/project', getCwd: () => '/project', getApprovalMode: () => 'default',
});
async function evalRule(arm, kind, rule, server, tool) {
  const { PermissionManager, DiscoveredMCPTool } = mods[arm];
  const t = new DiscoveredMCPTool(callable, server, tool, 'probe', {});
  const pm = new PermissionManager(cfg({ [kind]: [rule] }));
  pm.initialize();
  return pm.evaluate({ toolName: t.name, toolAliases: t.permissionAliases,
    mcpIdentity: { serverName: t.serverName, serverToolName: t.serverToolName } });
}

const SHAPES = [
  ['https://mcp.services.example.internal/sse?team=infra', 'deploy'],
  ['https://mcp.services.example.internal/sse?team=inf', 'run'],
  ['k'.repeat(53), 'tool'],
  ['a.b-' + 'k'.repeat(50), 'tool'],
];
const SIBLING = ['https://mcp.services.example.internal/sse?team=infra-staging', 'deploy'];

const out = { shapes: [] };
for (const [server, tool] of SHAPES) {
  const { DiscoveredMCPTool } = mods[arms[0]];
  const name = new DiscoveredMCPTool(callable, server, tool, 'probe', {}).name;
  const raw = `mcp__${server}__${tool}`;
  const rows = [];
  for (let L = 50; L <= name.length; L++) {
    const rule = name.slice(0, L) + '*';
    const row = { L, rule };
    for (const arm of arms) {
      row[arm] = { deny: await evalRule(arm, 'deny', rule, server, tool), allow: await evalRule(arm, 'allow', rule, server, tool) };
    }
    rows.push(row);
  }
  out.shapes.push({ server, tool, rawLen: raw.length, registered: name, rows });
  console.log(`\n${server} / ${tool}  raw=${raw.length}  registered=${name}`);
  console.log('  L   ' + arms.map((a) => a.padEnd(15)).join(''));
  for (const r of rows) console.log(`  ${String(r.L).padEnd(4)}` + arms.map((a) => `${r[a].deny}/${r[a].allow}`.padEnd(15)).join(''));
}
// Sibling key: does a rule written from infra's cut registration reach infra-staging?
{
  const { DiscoveredMCPTool } = mods[arms[0]];
  const own = new DiscoveredMCPTool(callable, SHAPES[0][0], SHAPES[0][1], 'probe', {}).name;
  const rule = own.slice(0, 56) + '*';
  const row = { rule, sibling: SIBLING };
  for (const arm of arms) row[arm] = { deny: await evalRule(arm, 'deny', rule, ...SIBLING), allow: await evalRule(arm, 'allow', rule, ...SIBLING) };
  out.sibling = row;
  console.log(`\nsibling ${SIBLING[0]} under ${rule}: ` + arms.map((a) => `${a}=${row[a].deny}/${row[a].allow}`).join('  '));
}
// R17-2 pin and #10199 pair must not move.
{
  const pins = [
    ['deny', 'mcp__foo_*', 'foo', '_internal'],
    ['allow', 'mcp__foo.bar', 'foo_bar', 'evil'],
    ['allow', 'mcp__foo.bar__*', 'foo_bar', 'evil'],
    ['deny', 'mcp__*', 'github', 'create_issue'],
  ];
  out.pins = [];
  for (const [kind, rule, s, t] of pins) {
    const row = { kind, rule, server: s, tool: t };
    for (const arm of arms) row[arm] = await evalRule(arm, kind, rule, s, t);
    out.pins.push(row);
    console.log(`pin ${kind} ${rule} -> ${s}/${t}: ` + arms.map((a) => `${a}=${row[a]}`).join('  '));
  }
}
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
