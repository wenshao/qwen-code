// Restrictive-direction differential for PR #12531 (round 4).
// For every (server key, tool) target, derive every rule that is literally an
// exact name or `<prefix>*` of the target's OWN raw / registered / legacy
// spelling, plus bare-server spellings, and ask each arm's real built modules:
//   L4  PermissionManager.evaluate()  (deny and ask lists)
//   L1  PermissionManager.isToolEnabled()  (registration-time disable)
//   SA  the subagent disallowedTools predicate each arm actually uses
// A "loss" is a row where the base arm restricts and the other arm does not:
// the tool would run although main blocks it. No registry competitor is
// involved: restrictive matching never consults the registry.
// usage: node deny-diff.mjs <outJson> <armA> <armB> [<armC> ...]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ARMS } from './scenarios.mjs';

const [outJson, ...arms] = process.argv.slice(2);
const load = async (arm) => {
  const d = `${ARMS[arm]}/packages/core/dist/src`;
  const imp = (p) => import(pathToFileURL(`${d}/${p}`).href);
  const pm = await imp('permissions/permission-manager.js');
  const mcp = await imp('tools/mcp-tool.js');
  const helpers = await imp('core/permission-helpers.js');
  const names = await imp('utils/tool-name-utils.js');
  const rp = await imp('permissions/rule-parser.js');
  let policy = null;
  try { policy = await imp('agents/runtime/subagent-plan-tool-policy.js'); } catch {}
  return { arm, pm, mcp, helpers, names, rp, policy };
};
const mods = [];
for (const a of arms) mods.push(await load(a));

const SERVERS = [
  'foo', 'foo_', '_foo', 'foo__bar', 'foo.bar', 'foo_bar', 'foo:bar', 'a__b', 'my__svc', 'github',
  'zybio.db', 'foo-bar', 'weather-forecast-premium', 'com.example.enterprise-search',
  'https://mcp.services.example.internal/sse?team=infra', 'https://mcp.services.example.internal/sse?team=inf',
  'x'.repeat(40), 'srv.with.dots_and__seps',
];
const TOOLS = [
  'deploy', '_internal', '__x', 'a.b', 'search.repos', 'navigate', '_hidden', 'bar__deploy_x',
  'get_extended_forecast_for_the_next_weeks', 'get+data_for_a_specific_location_and_date_range_extended',
  'x', 'Upper.Case-Tool', 'a'.repeat(32), '_admin_reset',
];

const stub = (deny, ask, mode = 'default') => ({
  getPermissionsAllow: () => [], getPermissionsAsk: () => ask, getPermissionsDeny: () => deny,
  getProjectRoot: () => '/tmp', getCwd: () => '/tmp', getApprovalMode: () => mode,
  getToolRegistry: () => ({ getMcpToolIdentities: () => [] }),
});

function mkTool(m, server, tool) {
  return new m.mcp.DiscoveredMCPTool({}, server, tool, 'd', { type: 'object', properties: {} }, false);
}

async function verdicts(m, server, tool, rule) {
  const t = mkTool(m, server, tool);
  // Mirror the real call sites:
  //  L4 permissionFlow: buildPermissionCheckContext(name, params, dir, invocation.permissionAliases, invocation.mcpIdentity)
  //  L1 scheduler prevalidation: pm.isToolEnabled(name, registry.getPermissionAliases(name), registry.getMcpToolIdentity(name))
  //     (base: pm.isToolEnabled(name))
  //  SA subagent filter: head matchesAgentToolBlocklist(list, name, registry aliases, registry identity);
  //     base matchesToolPattern(pattern, name)
  const inv = t.build({});
  const hasIdentity = inv.mcpIdentity !== undefined;
  const regAliases = t.permissionAliases.length ? t.permissionAliases : undefined;
  const regIdentity = hasIdentity ? { serverName: t.serverName, serverToolName: t.serverToolName } : undefined;
  const ctx = m.helpers.buildPermissionCheckContext(t.name, {}, '/tmp', inv.permissionAliases, inv.mcpIdentity);
  const out = {};
  for (const list of ['deny', 'ask']) {
    const p = new m.pm.PermissionManager(stub(list === 'deny' ? [rule] : [], list === 'ask' ? [rule] : []));
    p.initialize();
    out[list] = await p.evaluate(ctx);
    if (list === 'deny') {
      out.enabled = hasIdentity ? await p.isToolEnabled(t.name, regAliases, regIdentity) : await p.isToolEnabled(t.name);
    }
  }
  out.sa = m.policy?.matchesAgentToolBlocklist
    ? m.policy.matchesAgentToolBlocklist([rule], t.name, regAliases, regIdentity)
    : m.rp.matchesToolPattern(rule, t.name);
  return { name: t.name, out };
}

const rows = [];
const t0 = Date.now();
for (const server of SERVERS) for (const tool of TOOLS) {
  const raw = `mcp__${server}__${tool}`;
  const ref = mkTool(mods[0], server, tool);
  const registered = ref.name;
  const legacy = mods[0].names.generateLegacyMcpToolName(raw);
  const spellings = { raw, registered, legacy };
  const rules = new Map();
  for (const [kind, s] of Object.entries(spellings)) {
    rules.set(s, `${kind}:exact`);
    for (let L = 'mcp__'.length + 1; L <= s.length; L++) {
      const r = s.slice(0, L) + '*';
      if (!rules.has(r)) rules.set(r, `${kind}:prefix@${L}`);
    }
  }
  for (const seg of new Set([server, server.replace(/[^A-Za-z0-9_-]/g, '_'), server.replace(/[^A-Za-z0-9_.-]/g, '_')])) {
    const r = `mcp__${seg}`;
    if (!rules.has(r)) rules.set(r, 'bare-server');
  }
  rules.set('mcp__*', 'all-mcp');
  for (const [rule, kind] of rules) {
    const per = {};
    for (const m of mods) per[m.arm] = (await verdicts(m, server, tool, rule)).out;
    rows.push({ server, tool, registered, raw, legacy, rule, kind, per });
  }
}

// Summaries: base vs each other arm, per gate.
const base = arms[0];
const summary = {};
const losses = {};
const gains = {};
for (const other of arms.slice(1)) {
  const s = { rows: rows.length, denyLoss: 0, denyGain: 0, askLoss: 0, askGain: 0, l1Loss: 0, l1Gain: 0, saLoss: 0, saGain: 0 };
  const L = [];
  const G = [];
  for (const r of rows) {
    const a = r.per[base], b = r.per[other];
    const restr = (v) => v.deny === 'deny' || !v.enabled;
    if (restr(a) && !restr(b)) { s.denyLoss++; L.push({ gate: 'deny', ...r }); }
    if (!restr(a) && restr(b)) { s.denyGain++; G.push({ gate: 'deny', ...r }); }
    if (a.ask === 'ask' && b.ask !== 'ask' && b.ask !== 'deny') { s.askLoss++; L.push({ gate: 'ask', ...r }); }
    if (a.ask !== 'ask' && b.ask === 'ask') s.askGain++;
    if (!a.enabled && b.enabled) { s.l1Loss++; L.push({ gate: 'L1', ...r }); }
    if (a.enabled && !b.enabled) s.l1Gain++;
    if (a.sa && !b.sa) { s.saLoss++; L.push({ gate: 'subagent', ...r }); }
    if (!a.sa && b.sa) s.saGain++;
  }
  summary[`${base}->${other}`] = s;
  losses[`${base}->${other}`] = L;
  gains[`${base}->${other}`] = G;
}
// Pairwise between non-base arms too (e.g. prev -> head) to show what this round changed.
for (let i = 1; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
  const x = arms[i], y = arms[j];
  let diff = 0; const ex = [];
  for (const r of rows) {
    const a = r.per[x], b = r.per[y];
    if (a.deny !== b.deny || a.ask !== b.ask || a.enabled !== b.enabled || a.sa !== b.sa) { diff++; if (ex.length < 400) ex.push(r); }
  }
  summary[`${x}<->${y}`] = { differingRows: diff };
  losses[`${x}<->${y}`] = ex;
}
fs.writeFileSync(outJson, JSON.stringify({ arms, targets: SERVERS.length * TOOLS.length, rows: rows.length, ms: Date.now() - t0, summary, losses, gains }, null, 1));
console.log(JSON.stringify(summary, null, 1));
