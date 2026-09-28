// Real-environment probe for PR 12903 on a Windows runner. Prints one `PROBE_JSON {...}` line per case.
//  A. Which spelling of a variable a spawned process sees vs readEnvironmentVariable (head) and env[name] (base).
//  B. Which paths depend on the working directory (resolved by child processes in three cwds on two drives)
//     vs isFullyQualifiedPath.
//  C. End to end: the real CLI run from ws/ (drive D) is the host; the evaluation runs from launch/ (drive C)
//     with the same environment, head build vs base build (base = head dist with base's three compiled files).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const CLI = path.join(REPO, 'dist', 'cli.js');
const MOD = {
  head: path.join(REPO, 'packages/cli/dist/src/config/managed-compatibility.js'),
  base: path.join(REPO, 'packages/cli/dist-base/src/config/managed-compatibility.js'),
};
const lite = await import(pathToFileURL(path.join(REPO, 'packages/cli/dist/src/config/storage-paths-lite.js')).href);
const emit = (o) => console.log(`PROBE_JSON ${JSON.stringify(o)}`);
const j = (o) => JSON.stringify(o, null, 2);
emit({ case: 'runner', platform: os.platform(), release: os.release(), node: process.version, cwd: REPO, homedir: os.homedir(),
  drives: ['C:\\', 'D:\\'].filter((d) => fs.existsSync(d)) });

// Base environment without any spelling of the variables under test.
const UNDER_TEST = ['QWEN_HOME', 'QWEN_CODE_SYSTEM_SETTINGS_PATH', 'QWEN_CODE_SYSTEM_DEFAULTS_PATH', 'QWEN_RUNTIME_DIR', 'PROBE_MODE'];
const clean = {};
for (const [k, v] of Object.entries(process.env)) if (!UNDER_TEST.includes(k.toUpperCase())) clean[k] = v;

// ---- A. spawn spelling ground truth
{
  const V = [
    ['only lower', { qwen_home: 'L' }],
    ['upper + lower', { QWEN_HOME: 'U', qwen_home: 'L' }],
    ['lower + upper (insertion reversed)', { qwen_home: 'L', QWEN_HOME: 'U' }],
    ['Mixed + lower', { Qwen_Home: 'M', qwen_home: 'L' }],
    ['QWEN_Home + qwen_HOME', { qwen_HOME: 'x', QWEN_Home: 'y' }],
    ['first spelling undefined', { QWEN_HOME: undefined, qwen_home: 'L' }],
    ['later spelling undefined', { qwen_home: undefined, QWEN_HOME: 'U' }],
    ['inherited from prototype', Object.assign(Object.create({ QWEN_HOME: 'P' }), {})],
    ['sys path: lower only', { qwen_code_system_settings_path: 'S' }],
  ];
  let agree = 0, baseAgree = 0;
  for (const [name, extra] of V) {
    const env = Object.assign(Object.create(Object.getPrototypeOf(extra)), clean, extra);
    const varName = name.startsWith('sys') ? 'QWEN_CODE_SYSTEM_SETTINGS_PATH' : 'QWEN_HOME';
    const r = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(process.env[${JSON.stringify(varName)}] ?? null))`], { env, encoding: 'utf8' });
    const child = JSON.parse(r.stdout || 'null');
    const head = lite.readEnvironmentVariable(env, varName) ?? null;
    const base = env[varName] ?? null;
    agree += child === head; baseAgree += child === base;
    emit({ part: 'A', case: name, spawnedChildSees: child, headReads: head, baseReads: base, headAgrees: child === head, baseAgrees: child === base });
  }
  emit({ part: 'A', summary: true, variants: V.length, headAgrees: agree, baseAgrees: baseAgree });
}

// ---- B. which paths depend on the working directory
{
  const cwds = ['C:\\pr12903-cwd\\a', 'C:\\pr12903-cwd\\b', 'D:\\pr12903-cwd\\c'].filter((d) => fs.existsSync(d.slice(0, 3)));
  for (const d of cwds) fs.mkdirSync(d, { recursive: true });
  const P = ['qh', '.\\qh', '..\\qh', '\\qh', '/qh', 'C:qh', 'D:qh', 'c:qh', 'C:', 'C:\\', 'C:\\t\\qh', 'C:/t/qh', 'c:\\t\\qh', 'D:\\t\\qh',
    '\\\\localhost\\C$\\t', '//localhost/C$/t', '\\/localhost/C$/t', '\\\\?\\C:\\t', '\\\\.\\C:\\t', '\\\\server\\share', '\\\\server\\share\\x',
    '\\\\server', '\\\\server\\', '\\\\\\server\\share', '~\\qh', ''];
  const counts = { agree: 0, conservative: 0, unsafe: 0 };
  for (const p of P) {
    const resolved = cwds.map((cwd) => spawnSync(process.execPath, ['-e', `process.stdout.write(require('path').resolve(${JSON.stringify(p)}))`], { cwd, env: clean, encoding: 'utf8' }).stdout);
    const depends = new Set(resolved).size > 1;
    const qualified = lite.isFullyQualifiedPath(p);
    const verdict = qualified === !depends ? 'agree' : qualified ? 'unsafe' : 'conservative';
    counts[verdict]++;
    emit({ part: 'B', path: p, resolvedFrom: Object.fromEntries(cwds.map((c, i) => [c, resolved[i]])), dependsOnCwd: depends, isFullyQualifiedPath: qualified, verdict });
  }
  emit({ part: 'B', summary: true, paths: P.length, cwds, ...counts });
}

// ---- C. end to end
const E2E_C = 'C:\\pr12903-e2e', E2E_D = fs.existsSync('D:\\') ? 'D:\\pr12903-e2e' : 'C:\\pr12903-e2e-ws';
fs.rmSync(E2E_C, { recursive: true, force: true }); fs.rmSync(E2E_D, { recursive: true, force: true });
const EXT = path.join(E2E_D, 'ext-mcp');
fs.mkdirSync(EXT, { recursive: true });
fs.writeFileSync(path.join(EXT, 'qwen-extension.json'), j({ name: 'mcp-ext', version: '1.0.0', mcpServers: { probe: { command: 'node', args: ['-e', '0'] } } }));
const mcpSettings = j({ mcpServers: { s: { command: 'node', args: ['-e', '0'] } } });

function runCli(cwd, env, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 180000, input: '' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim();
}
function evaluate(which, launch, ws, procEnv, environment) {
  const script = `const { evaluateManagedCompatibility } = await import(${JSON.stringify(pathToFileURL(MOD[which]).href)});
const r = await evaluateManagedCompatibility({ workspaceCwd: ${JSON.stringify(ws)} }, { workspaceCwd: ${JSON.stringify(ws)}, workspaceTrusted: true,
  environment: JSON.parse(process.env.PROBE_ENV_JSON), forwardedArgs: [], hasLiveMcpServers: () => false });
process.stdout.write(JSON.stringify(r));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: launch, env: { ...procEnv, PROBE_ENV_JSON: JSON.stringify(environment) }, encoding: 'utf8', timeout: 120000 });
  try { const o = JSON.parse(r.stdout); return o.status + (o.reason ? ` (${o.reason})` : ''); } catch { return `ERROR ${(r.stdout + r.stderr).slice(0, 300)}`; }
}

const CASES = [
  { id: 'QWEN_HOME absolute (control)', kind: 'ext', env: (c) => ({ QWEN_HOME: path.join(c.ws, 'qh') }) },
  { id: 'qwen_home absolute (lower case)', kind: 'ext', env: (c) => ({ qwen_home: path.join(c.ws, 'qh') }) },
  { id: 'QWEN_HOME relative', kind: 'ext', env: () => ({ QWEN_HOME: 'qh' }) },
  { id: 'qwen_home relative (lower case)', kind: 'ext', env: () => ({ qwen_home: 'qh' }) },
  { id: 'QWEN_HOME rooted without a drive', kind: 'ext', env: (c) => ({ QWEN_HOME: `\\pr12903-rooted\\${c.slug}\\qh` }) },
  { id: 'QWEN_HOME drive-relative (D:qh)', kind: 'ext', env: (c) => ({ QWEN_HOME: `${c.ws.slice(0, 2)}qh-${c.slug}` }) },
  { id: 'QWEN_HOME UNC (\\\\localhost\\D$\\...)', kind: 'ext', env: (c) => ({ QWEN_HOME: `\\\\localhost\\${c.ws[0]}$${path.join(c.ws, 'qh').slice(2)}` }) },
  { id: 'QWEN_HOME ~\\qh', kind: 'ext', env: () => ({ QWEN_HOME: '~\\qh' }) },
  { id: 'two spellings: QWEN_Home=store with ext, qwen_home=empty', kind: 'ext-first', env: (c) => ({ QWEN_Home: path.join(c.ws, 'qh'), qwen_home: path.join(c.ws, 'empty') }) },
  { id: 'two spellings: QWEN_Home=empty, qwen_home=store with ext', kind: 'ext-second', env: (c) => ({ QWEN_Home: path.join(c.ws, 'empty'), qwen_home: path.join(c.ws, 'qh') }) },
  { id: 'qwen_code_system_settings_path absolute (lower case)', kind: 'sys', env: (c) => ({ qwen_code_system_settings_path: path.join(c.ws, 'sys-settings.json') }) },
  { id: 'QWEN_CODE_SYSTEM_SETTINGS_PATH relative', kind: 'sys', env: () => ({ QWEN_CODE_SYSTEM_SETTINGS_PATH: 'sys-settings.json' }) },
  { id: 'placeholder ${PROBE_MODE} with probe_mode=plan', kind: 'placeholder', env: () => ({ probe_mode: 'plan' }) },
  { id: 'placeholder ${PROBE_MODE} with probe_mode=yolo', kind: 'placeholder', env: () => ({ probe_mode: 'yolo' }) },
];
const rows = [];
for (const k of CASES) {
  const slug = k.id.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  const c = { slug, dir: path.join(E2E_D, slug), launch: path.join(E2E_C, slug, 'launch') };
  c.ws = path.join(c.dir, 'ws'); c.home = path.join(c.dir, 'home');
  for (const d of [c.ws, c.home, path.join(c.dir, 'runtime'), path.join(c.dir, 'sys'), c.launch]) fs.mkdirSync(d, { recursive: true });
  const base = { ...clean, HOME: c.home, USERPROFILE: c.home, QWEN_RUNTIME_DIR: path.join(c.dir, 'runtime'), NO_COLOR: '1' };
  if (!k.kind.startsWith('sys')) base.QWEN_CODE_SYSTEM_SETTINGS_PATH = path.join(c.dir, 'sys', 'settings.json');
  base.QWEN_CODE_SYSTEM_DEFAULTS_PATH = path.join(c.dir, 'sys', 'defaults.json');
  const extra = k.env(c);
  const environment = { ...base, ...extra };
  let setup = '';
  if (k.kind === 'ext') setup = runCli(c.ws, environment, ['extensions', 'install', EXT, '--consent']).split('\n').pop();
  if (k.kind === 'ext-first' || k.kind === 'ext-second') {
    // Install into ws/qh explicitly; ws/empty stays without extensions.
    setup = runCli(c.ws, { ...base, QWEN_HOME: path.join(c.ws, 'qh') }, ['extensions', 'install', EXT, '--consent']).split('\n').pop();
    fs.mkdirSync(path.join(c.ws, 'empty'), { recursive: true });
  }
  if (k.kind === 'sys') fs.writeFileSync(path.join(c.ws, 'sys-settings.json'), mcpSettings);
  if (k.kind === 'placeholder') { fs.mkdirSync(path.join(c.home, '.qwen'), { recursive: true }); fs.writeFileSync(path.join(c.home, '.qwen', 'settings.json'), j({ $version: 4, tools: { approvalMode: '${PROBE_MODE}' } })); }
  const list = k.kind === 'placeholder' ? '' : runCli(c.ws, environment, ['mcp', 'list']);
  const hostLoads = k.kind === 'placeholder' ? null : /\b(probe|s): node\b/.test(list);
  // The evaluating process runs with the base environment (its own home) and is given the hosts' environment.
  const verdicts = { base: evaluate('base', c.launch, c.ws, base, environment), head: evaluate('head', c.launch, c.ws, base, environment) };
  const row = { part: 'C', case: k.id, extra, setup: setup.slice(0, 160), hostLoads, hostList: list.split('\n').slice(-2).join(' | ').slice(0, 240), ...verdicts,
    falseCompatible: { base: hostLoads === true && verdicts.base.startsWith('compatible'), head: hostLoads === true && verdicts.head.startsWith('compatible') } };
  rows.push(row); emit(row);
}
emit({ part: 'C', summary: true, cases: rows.length, falseCompatibleBase: rows.filter((r) => r.falseCompatible.base).map((r) => r.case), falseCompatibleHead: rows.filter((r) => r.falseCompatible.head).map((r) => r.case) });
