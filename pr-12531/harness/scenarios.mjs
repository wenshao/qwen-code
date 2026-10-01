// Real-CLI A/B matrix for PR #12531: real stdio MCP servers + scripted fake model + real `qwen -p`.
// usage: node run-matrix.mjs <outDir> [scenarioId...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARMS = {
  fix: '/root/verify/pr12531/fix',
  base: '/root/verify/pr12531/base',
  head: '/root/verify/pr12531/head',
};
export const HARNESS = '/root/verify/pr12531/harness';

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

export const SCENARIOS = [
  // --- #10199 variant 1: the central claim ---
  { id: 'S1', title: 'allow mcp__foo.bar -> call server foo_bar tool evil (attacker)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, allow: ['mcp__foo.bar'], mode: 'default', target: ['foo_bar', 'evil'] },
  { id: 'S1c', title: 'allow mcp__foo.bar -> call server foo.bar tool evil (own server, control)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, allow: ['mcp__foo.bar'], mode: 'default', target: ['foo.bar', 'evil'] },
  { id: 'S1w', title: 'allow mcp__foo.bar__* -> call server foo_bar tool evil (attacker)',
    servers: { 'foo.bar': ['evil'], 'foo_bar': ['evil'] }, allow: ['mcp__foo.bar__*'], mode: 'default', target: ['foo_bar', 'evil'] },
  // --- R13-1 / R4-2: server foo vs foo_ (closed by 1e29efde68's identity channel) ---
  { id: 'S4', title: 'allow mcp__foo -> call server foo_ tool x (registered mcp__foo___x)',
    servers: { foo: ['deploy'], foo_: ['x'] }, allow: ['mcp__foo'], mode: 'default', target: ['foo_', 'x'] },
  { id: 'S4c', title: 'allow mcp__foo -> call server foo tool deploy (own server, control)',
    servers: { foo: ['deploy'], foo_: ['x'] }, allow: ['mcp__foo'], mode: 'default', target: ['foo', 'deploy'] },
  // --- deny coverage in the provider-safe (registered / UI) spelling, YOLO so only the deny rule stands in the way ---
  { id: 'D1', title: 'yolo + deny mcp__zybio_db (registered spelling) -> call zybio.db tool search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: ['mcp__zybio_db'], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D2', title: 'yolo + deny mcp__zybio_db__* -> call zybio.db tool search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: ['mcp__zybio_db__*'], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D3', title: 'yolo + deny mcp__github__search_* -> call github tool search.repos',
    servers: { github: ['search.repos'] }, deny: ['mcp__github__search_*'], mode: 'yolo', target: ['github', 'search.repos'] },
  { id: 'D4', title: 'yolo + deny mcp__zybio.db (raw spelling, control) -> call zybio.db tool search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: ['mcp__zybio.db'], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D5', title: 'yolo + deny <exact registered name> (control) -> call zybio.db tool search_pubmed',
    servers: { 'zybio.db': ['search_pubmed'] }, deny: [() => reg('zybio.db', 'search_pubmed')], mode: 'yolo', target: ['zybio.db', 'search_pubmed'] },
  { id: 'D6', title: 'yolo + deny mcp__foo.bar__get_data_for_a_specific* (R14-2 shape) -> call foo.bar tool get+data_…',
    servers: { 'foo.bar': [R142_TOOL] }, deny: ['mcp__foo.bar__get_data_for_a_specific*'], mode: 'yolo', target: ['foo.bar', R142_TOOL] },
  { id: 'D7', title: 'yolo + deny <truncated legacy exact spelling> (F6 shape, 29-char key)',
    servers: { [LONG_KEY]: [LONG_TOOL] }, deny: [() => legacy(LONG_KEY, LONG_TOOL)], mode: 'yolo', target: [LONG_KEY, LONG_TOOL] },
  { id: 'D8', title: 'yolo + deny mcp__foo_bar (registered spelling) -> call foo:bar tool a.b',
    servers: { 'foo:bar': ['a.b'] }, deny: ['mcp__foo_bar'], mode: 'yolo', target: ['foo:bar', 'a.b'] },
  // --- the documented match-all MCP wildcard, on a plain provider-safe server/tool ---
  { id: 'M1', title: 'yolo + deny mcp__* -> call github tool create_issue',
    servers: { github: ['create_issue'] }, deny: ['mcp__*'], mode: 'yolo', target: ['github', 'create_issue'] },
  { id: 'M2', title: 'allow mcp__* -> call github tool create_issue (default mode)',
    servers: { github: ['create_issue'] }, allow: ['mcp__*'], mode: 'default', target: ['github', 'create_issue'] },
  { id: 'M3', title: 'yolo + deny mcp__github__* (control) -> call github tool create_issue',
    servers: { github: ['create_issue'] }, deny: ['mcp__github__*'], mode: 'yolo', target: ['github', 'create_issue'] },
  { id: 'M4', title: 'no rules, default mode (control) -> call github tool create_issue',
    servers: { github: ['create_issue'] }, mode: 'default', target: ['github', 'create_issue'] },
  { id: 'M5', title: 'no rules, yolo (control) -> call github tool create_issue',
    servers: { github: ['create_issue'] }, mode: 'yolo', target: ['github', 'create_issue'] },
];


export const cleanEnv = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_COLOR', 'QWEN_CODE_SIMPLE', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DASHSCOPE_API_KEY']) delete cleanEnv[k];

export function resolveList(l) { return (l ?? []).map((x) => (typeof x === 'function' ? x() : x)); }

// Writes HOME/.qwen/settings.json for one (scenario, arm) run; returns paths.
export function setupRun(sc, run) {
  fs.rmSync(run, { recursive: true, force: true });
  const home = path.join(run, 'home'), ws = path.join(run, 'ws');
  fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const hits = path.join(run, 'hits.jsonl');
  fs.writeFileSync(hits, '');
  const mcpServers = {};
  for (const [name, tools] of Object.entries(sc.servers)) {
    mcpServers[name] = { command: process.execPath, args: [`${HARNESS}/mcp-server.mjs`, name, hits, ...tools] };
  }
  const settings = { mcpServers, permissions: { allow: resolveList(sc.allow), deny: resolveList(sc.deny) }, security: { folderTrust: { enabled: false } } };
  fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify(settings, null, 2));
  return { home, ws, hits, modelLog: path.join(run, 'model.jsonl'), settings };
}

export function startFake(logFile, target) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [`${HARNESS}/fake-model.mjs`, logFile], {
      env: { ...process.env, TARGET_TOOL: target }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    p.stdout.on('data', (d) => {
      const m = /FAKE_READY (\S+)/.exec(String(d));
      if (m) resolve({ proc: p, url: m[1] });
    });
    p.on('exit', () => reject(new Error('fake model exited')));
  });
}
