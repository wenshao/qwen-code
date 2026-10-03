// Real-CLI A/B matrix for PR #12531 (round 2, head dbab8f48f0): real stdio MCP servers + scripted fake model + real `qwen -p`.
// usage: node run-matrix.mjs <outDir> [scenarioId...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const V = '/Users/wenshao/git/verify-pr12531';
export const ARMS = {
  base: `${V}/base`,
  head: `${V}/head`,
  candA: `${V}/candA`,
  candC: `${V}/candC`,
  merge: `${V}/merge`,
  head3: `${V}/head3`,
  candD: `${V}/candD`,
  merge3: `${V}/merge3`,
};
export const ARM_LABEL = {
  base: 'base b3dda468f2',
  head: 'head dbab8f48f0',
  candA: 'head + author (a) discriminator',
  candC: 'head + restrictive-only fallback',
  merge: 'head merged into main 1a933f7b5e',
  head3: 'head 5bfea95dd7',
  candD: 'head 5bfea95dd7 + F13 restrictive prefix',
  merge3: 'head 5bfea95dd7 merged into main 5130c1a734',
};
export const HARNESS = `${V}/harness`;

// Registered names come from the arm's own producer (identical function on both arms; asserted below).
const names = {};
for (const [arm, dir] of Object.entries({ base: ARMS.base, head: ARMS.head })) {
  names[arm] = await import(pathToFileURL(`${dir}/packages/core/dist/src/utils/tool-name-utils.js`).href);
}
export const reg = (server, tool) => {
  const raw = `mcp__${server}__${tool}`;
  const a = names.base.normalizeToolNameForProvider(raw);
  const b = names.head.normalizeToolNameForProvider(raw);
  if (a !== b) throw new Error(`registered-name drift for ${raw}: ${a} vs ${b}`);
  return a;
};
export const legacy = (server, tool) => names.head.generateLegacyMcpToolName(`mcp__${server}__${tool}`);

const LONG_KEY = 'com.example.enterprise-search'; // 29 chars, F6 shape
const LONG_TOOL = 'a'.repeat(32);
const R142_TOOL = 'get+data_for_a_specific_location_and_date_range_extended';

// R15-1 shape (PR test plan step 2): trusted server, 24-char key, 40-char tool.
const K24 = 'weather-forecast-premium';
const T40 = 'get_extended_forecast_for_the_next_weeks';
// Two regional deployments whose truncated legacy names coincide (PR test plan step 3).
const KEU = 'enterprise-search-prod-eu';
const KUS = 'enterprise-search-prod-us';
// R18-1 shape: URL-style key >= 50 sanitized chars; registration cut at 55 + `_<hash>`, separator lost.
const URL52 = 'https://mcp.services.example.internal/sse?team=infra';
const URL60 = 'https://mcp.services.example.internal/sse?team=infra-staging'; // sibling: same first 50 sanitized chars
const URL50 = 'https://mcp.services.example.internal/sse?team=inf'; // raw name 60 chars (<= 63) but still cut
const cutPrefix = (server, tool) => reg(server, tool).slice(0, 56) + '*'; // `..._inf_*`: what /tools shows up to the injected `_`

const T = (tools) => ({ tools, trust: true });

export const SCENARIOS = [
  // ===== Group R: previous round's matrix (fail-open regression at 985683eb4d) re-run on the new head =====
  { id: 'S1', group: 'R', title: 'allow mcp__foo.bar -> call server foo_bar tool evil (attacker)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, allow: ['mcp__foo.bar'], mode: 'default', target: ['foo_bar', 'evil'] },
  { id: 'S1c', group: 'R', title: 'allow mcp__foo.bar -> call server foo.bar tool evil (own server, control)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, allow: ['mcp__foo.bar'], mode: 'default', target: ['foo.bar', 'evil'] },
  { id: 'S1w', group: 'R', title: 'allow mcp__foo.bar__* -> call server foo_bar tool evil (attacker)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, allow: ['mcp__foo.bar__*'], mode: 'default', target: ['foo_bar', 'evil'] },
  { id: 'S4', group: 'R', title: 'allow mcp__foo -> call server foo_ tool x (registered mcp__foo___x)',
    servers: { foo: ['deploy'], foo_: ['x'] }, allow: ['mcp__foo'], mode: 'default', target: ['foo_', 'x'] },
  { id: 'S4c', group: 'R', title: 'allow mcp__foo -> call server foo tool deploy (own server, control)',
    servers: { foo: ['deploy'], foo_: ['x'] }, allow: ['mcp__foo'], mode: 'default', target: ['foo', 'deploy'] },
  { id: 'D1', group: 'R', title: 'yolo + deny mcp__zybio_db (registered spelling) -> zybio.db/search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: ['mcp__zybio_db'], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D2', group: 'R', title: 'yolo + deny mcp__zybio_db__* -> zybio.db/search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: ['mcp__zybio_db__*'], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D3', group: 'R', title: 'yolo + deny mcp__github__search_* -> github/search.repos',
    servers: { github: ['search.repos'] }, deny: ['mcp__github__search_*'], mode: 'yolo', target: ['github', 'search.repos'] },
  { id: 'D4', group: 'R', title: 'yolo + deny mcp__zybio.db (raw spelling, control) -> zybio.db/search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: ['mcp__zybio.db'], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D5', group: 'R', title: 'yolo + deny <exact registered name> (control) -> zybio.db/search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: [() => reg('zybio.db', 'search_pubmed')], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D6', group: 'R', title: 'yolo + deny mcp__foo.bar__get_data_for_a_specific* (R14-2 shape)',
    servers: { 'foo.bar': [R142_TOOL] }, deny: ['mcp__foo.bar__get_data_for_a_specific*'], mode: 'yolo', target: ['foo.bar', R142_TOOL] },
  { id: 'D7', group: 'R', title: 'yolo + deny <truncated legacy exact spelling> (F6 shape, 29-char key)',
    servers: { [LONG_KEY]: [LONG_TOOL] }, deny: [() => legacy(LONG_KEY, LONG_TOOL)], mode: 'yolo', target: [LONG_KEY, LONG_TOOL] },
  { id: 'D8', group: 'R', title: 'yolo + deny mcp__foo_bar (registered spelling) -> foo:bar/a.b',
    servers: { 'foo:bar': ['a.b'] }, deny: ['mcp__foo_bar'], mode: 'yolo', target: ['foo:bar', 'a.b'] },
  { id: 'M1', group: 'R', title: 'yolo + deny mcp__* -> github/create_issue',
    servers: { github: ['create_issue'] }, deny: ['mcp__*'], mode: 'yolo', target: ['github', 'create_issue'] },
  { id: 'M2', group: 'R', title: 'allow mcp__* -> github/create_issue (default mode)',
    servers: { github: ['create_issue'] }, allow: ['mcp__*'], mode: 'default', target: ['github', 'create_issue'] },
  { id: 'M3', group: 'R', title: 'yolo + deny mcp__github__* (control) -> github/create_issue',
    servers: { github: ['create_issue'] }, deny: ['mcp__github__*'], mode: 'yolo', target: ['github', 'create_issue'] },
  { id: 'M4', group: 'R', title: 'no rules, default mode (control) -> github/create_issue',
    servers: { github: ['create_issue'] }, mode: 'default', target: ['github', 'create_issue'] },
  { id: 'M5', group: 'R', title: 'no rules, yolo (control) -> github/create_issue',
    servers: { github: ['create_issue'] }, mode: 'yolo', target: ['github', 'create_issue'] },

  // ===== Group T: R15-1 (dbab8f48f0) — exact truncated legacy restrictions on a TRUSTED server, default mode =====
  { id: 'T0', group: 'T', title: 'trusted 24-char key, no rules (control: trust auto-approves)',
    servers: { [K24]: T([T40]) }, mode: 'default', target: [K24, T40] },
  { id: 'T1', group: 'T', title: 'trusted, deny <truncated legacy exact>',
    servers: { [K24]: T([T40]) }, deny: [() => legacy(K24, T40)], mode: 'default', target: [K24, T40] },
  { id: 'T2', group: 'T', title: 'trusted, ask <truncated legacy exact>',
    servers: { [K24]: T([T40]) }, ask: [() => legacy(K24, T40)], mode: 'default', target: [K24, T40] },
  { id: 'T3', group: 'T', title: 'untrusted, allow <truncated legacy exact> (must not grant)',
    servers: { [K24]: [T40] }, allow: [() => legacy(K24, T40)], mode: 'default', target: [K24, T40] },
  { id: 'T4', group: 'T', title: 'trusted EU+US, deny legacy(EU) -> call US (shared truncated legacy name)',
    servers: { [KEU]: T([T40]), [KUS]: T([T40]) }, deny: [() => legacy(KEU, T40)], mode: 'default', target: [KUS, T40] },
  { id: 'T5', group: 'T', title: 'trusted EU + github, deny legacy(EU) -> call github (unrelated, control)',
    servers: { [KEU]: T([T40]), github: T(['create_issue']) }, deny: [() => legacy(KEU, T40)], mode: 'default', target: ['github', 'create_issue'] },

  // ===== Group U: R18-1 (open Critical) — wildcard copied from a budget-cut registration =====
  { id: 'U0', group: 'U', title: 'trusted 52-char URL key, no rules (control)',
    servers: { [URL52]: T(['deploy']) }, mode: 'default', target: [URL52, 'deploy'] },
  { id: 'U1', group: 'U', title: 'trusted, deny <registered name>* (copied from /tools)',
    servers: { [URL52]: T(['deploy']) }, deny: [() => reg(URL52, 'deploy') + '*'], mode: 'default', target: [URL52, 'deploy'] },
  { id: 'U2', group: 'U', title: 'trusted, deny <registered[:56]>* (`..._inf_*`)',
    servers: { [URL52]: T(['deploy', 'status']) }, deny: [() => cutPrefix(URL52, 'deploy')], mode: 'default', target: [URL52, 'status'] },
  { id: 'U3', group: 'U', title: 'trusted, deny mcp__<sanitized key>__* (whole-server, control)',
    servers: { [URL52]: T(['deploy']) }, deny: ['mcp__https___mcp_services_example_internal_sse_team_infra__*'], mode: 'default', target: [URL52, 'deploy'] },
  { id: 'U4', group: 'U', title: 'trusted, deny <exact registered name> (control)',
    servers: { [URL52]: T(['deploy']) }, deny: [() => reg(URL52, 'deploy')], mode: 'default', target: [URL52, 'deploy'] },
  { id: 'U5', group: 'U', title: 'trusted 50-char URL key + tool `run` (raw 60 <= 63), deny <registered>*',
    servers: { [URL50]: T(['run']) }, deny: [() => reg(URL50, 'run') + '*'], mode: 'default', target: [URL50, 'run'] },
  { id: 'U6', group: 'U', title: 'untrusted, allow <registered[:56]>* -> own server',
    servers: { [URL52]: ['deploy'] }, allow: [() => cutPrefix(URL52, 'deploy')], mode: 'default', target: [URL52, 'deploy'] },
  { id: 'U7', group: 'U', title: 'untrusted, allow <infra registered[:56]>* -> SIBLING infra-staging',
    servers: { [URL52]: ['deploy'], [URL60]: ['deploy'] }, allow: [() => cutPrefix(URL52, 'deploy')], mode: 'default', target: [URL60, 'deploy'] },
  { id: 'U8', group: 'U', title: 'trusted, deny <infra registered[:56]>* -> SIBLING infra-staging',
    servers: { [URL52]: T(['deploy']), [URL60]: T(['deploy']) }, deny: [() => cutPrefix(URL52, 'deploy')], mode: 'default', target: [URL60, 'deploy'] },

  // ===== Group F: F13 (sandbox round at dbab8f48f0) — key ending in `_`, pure-underscore tool prefix =====
  { id: 'F0', group: 'F', title: 'trusted foo_ / _internal, no rules (control)',
    servers: { foo_: T(['_internal']) }, mode: 'default', target: ['foo_', '_internal'] },
  { id: 'F1', group: 'F', title: 'trusted, deny mcp__foo____* (literal prefix of mcp__foo____internal)',
    servers: { foo_: T(['_internal']) }, deny: ['mcp__foo____*'], mode: 'default', target: ['foo_', '_internal'] },
  { id: 'F2', group: 'F', title: 'trusted foo_ / __x, deny mcp__foo_____* (literal prefix of mcp__foo_____x)',
    servers: { foo_: T(['__x']) }, deny: ['mcp__foo_____*'], mode: 'default', target: ['foo_', '__x'] },
  { id: 'F3', group: 'F', title: 'trusted, ask mcp__foo____* -> foo_ / _internal',
    servers: { foo_: T(['_internal']) }, ask: ['mcp__foo____*'], mode: 'default', target: ['foo_', '_internal'] },
  { id: 'F4', group: 'F', title: 'subagent disallowedTools [mcp__foo____*] -> foo_ / _internal',
    servers: { foo_: ['_internal'] }, agent: { disallowedTools: ['mcp__foo____*'] }, mode: 'yolo', target: ['foo_', '_internal'] },
  { id: 'F5', group: 'F', title: 'trusted, deny mcp__foo___* (documented whole-server, control)',
    servers: { foo_: T(['_internal']) }, deny: ['mcp__foo___*'], mode: 'default', target: ['foo_', '_internal'] },
  { id: 'F6', group: 'F', title: 'trusted, deny mcp__foo____in* (real-character tool filter, control)',
    servers: { foo_: T(['_internal']) }, deny: ['mcp__foo____in*'], mode: 'default', target: ['foo_', '_internal'] },
  { id: 'F7', group: 'F', title: 'untrusted foo + foo_, allow mcp__foo____* -> foo_ / _internal (R13-1 pin)',
    servers: { foo: ['__dbg'], foo_: ['_internal'] }, allow: ['mcp__foo____*'], mode: 'default', target: ['foo_', '_internal'] },
  { id: 'F8', group: 'F', title: 'untrusted foo + foo_, allow mcp__foo____* -> foo / __dbg (own reading, control)',
    servers: { foo: ['__dbg'], foo_: ['_internal'] }, allow: ['mcp__foo____*'], mode: 'default', target: ['foo', '__dbg'] },

  { id: 'K1', group: 'K', title: 'trusted a__b / _hidden, deny mcp__a__b___* (bot R17-1 shape: key contains __)',
    servers: { a__b: T(['_hidden']) }, deny: ['mcp__a__b___*'], mode: 'default', target: ['a__b', '_hidden'] },
  { id: 'K2', group: 'K', title: 'trusted my__svc / _internal, deny mcp__my__svc___*',
    servers: { my__svc: T(['_internal']) }, deny: ['mcp__my__svc___*'], mode: 'default', target: ['my__svc', '_internal'] },
  { id: 'K3', group: 'K', title: 'subagent disallowedTools [mcp__a__b___*] -> a__b / _hidden',
    servers: { a__b: ['_hidden'] }, agent: { disallowedTools: ['mcp__a__b___*'] }, mode: 'yolo', target: ['a__b', '_hidden'] },
  { id: 'K4', group: 'K', title: 'trusted a__b, deny mcp__a__b___hi* (real-character tool filter, control)',
    servers: { a__b: T(['_hidden']) }, deny: ['mcp__a__b___hi*'], mode: 'default', target: ['a__b', '_hidden'] },
  { id: 'K5', group: 'K', title: 'untrusted a__b, allow mcp__a__b___* (grant direction)',
    servers: { a__b: ['_hidden'] }, allow: ['mcp__a__b___*'], mode: 'default', target: ['a__b', '_hidden'] },

  // ===== Group A: real subagent dispatch, `disallowedTools` is the only guard (yolo) =====
  { id: 'A0', group: 'A', title: 'subagent, no disallowedTools (control) -> github/create_issue',
    servers: { github: ['create_issue'] }, agent: { disallowedTools: [] }, mode: 'yolo', target: ['github', 'create_issue'] },
  { id: 'A1', group: 'A', title: 'subagent disallowedTools [mcp__*] -> github/create_issue',
    servers: { github: ['create_issue'] }, agent: { disallowedTools: ['mcp__*'] }, mode: 'yolo', target: ['github', 'create_issue'] },
  { id: 'A2', group: 'A', title: 'subagent disallowedTools [mcp__zybio_db] -> zybio.db/search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, agent: { disallowedTools: ['mcp__zybio_db'] }, mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'A3', group: 'A', title: 'subagent disallowedTools [<truncated legacy exact>] (R15-1 shape)',
    servers: { [K24]: [T40] }, agent: { disallowedTools: [() => legacy(K24, T40)] }, mode: 'yolo', target: [K24, T40] },
  { id: 'A4', group: 'A', title: 'subagent disallowedTools [<registered>*] (R18-1 shape)',
    servers: { [URL52]: ['deploy'] }, agent: { disallowedTools: [() => reg(URL52, 'deploy') + '*'] }, mode: 'yolo', target: [URL52, 'deploy'] },
  { id: 'A5', group: 'A', title: 'subagent disallowedTools [mcp__foo.bar] -> server foo_bar (must still run)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, agent: { disallowedTools: ['mcp__foo.bar'] }, mode: 'yolo', target: ['foo_bar', 'evil'] },
];

export const cleanEnv = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_COLOR', 'QWEN_CODE_SIMPLE', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DASHSCOPE_API_KEY']) delete cleanEnv[k];
for (const k of Object.keys(cleanEnv)) if (k.startsWith('QWEN_')) delete cleanEnv[k];

export function resolveList(l) { return (l ?? []).map((x) => (typeof x === 'function' ? x() : x)); }

// Writes HOME/.qwen/settings.json (+ optional ws/.qwen/agents/verifier.md) for one (scenario, arm) run.
export function setupRun(sc, run) {
  fs.rmSync(run, { recursive: true, force: true });
  const home = path.join(run, 'home'), ws = path.join(run, 'ws');
  fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const hits = path.join(run, 'hits.jsonl');
  fs.writeFileSync(hits, '');
  const mcpServers = {};
  for (const [name, spec] of Object.entries(sc.servers)) {
    const tools = Array.isArray(spec) ? spec : spec.tools;
    mcpServers[name] = { command: process.execPath, args: [`${HARNESS}/mcp-server.mjs`, name, hits, ...tools] };
    if (!Array.isArray(spec) && spec.trust) mcpServers[name].trust = true;
  }
  const permissions = { allow: resolveList(sc.allow), ask: resolveList(sc.ask), deny: resolveList(sc.deny) };
  const settings = { mcpServers, permissions, security: { folderTrust: { enabled: false } } };
  fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify(settings, null, 2));
  if (sc.agent) {
    const dis = resolveList(sc.agent.disallowedTools);
    fs.mkdirSync(path.join(ws, '.qwen', 'agents'), { recursive: true });
    const fm = ['---', 'name: verifier', 'description: PR12531 verification subagent'];
    if (dis.length) fm.push('disallowedTools:', ...dis.map((d) => `  - ${JSON.stringify(d)}`));
    fm.push('---', '', 'SUBAGENT-PR12531 marker. Call the tool you are told to call.', '');
    fs.writeFileSync(path.join(ws, '.qwen', 'agents', 'verifier.md'), fm.join('\n'));
  }
  return { home, ws, hits, modelLog: path.join(run, 'model.jsonl'), settings };
}

export function startFake(logFile, target, mode = 'direct') {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [`${HARNESS}/fake-model.mjs`, logFile], {
      env: { ...process.env, TARGET_TOOL: target, FAKE_MODE: mode }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    p.stdout.on('data', (d) => {
      const m = /FAKE_READY (\S+)/.exec(String(d));
      if (m) resolve({ proc: p, url: m[1] });
    });
    p.on('exit', () => reject(new Error('fake model exited')));
  });
}
