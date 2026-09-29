// PR 12934 on a real Windows runner: the host-oracle matrix. For each environment shape,
//   host    = the real CLI (dist/cli.js) spawned by node:child_process with that env object, cwd ws\ (drive D):
//             the MCP servers it configures (`mcp list`), and for `$0` rows the host's own loadSettings +
//             populateMcpServerCommand in a child spawned with the same env;
//   verdict = evaluateManagedCompatibility run from launch\ (drive C) with the same env object,
//             head build vs base build (base = head dist with base's three compiled files).
// Prints one `PROBE_JSON {...}` line per case.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from './env-spec.mjs';

const REPO = process.cwd();
const P = path.join(REPO, '.probe');
const CLI = path.join(REPO, 'dist', 'cli.js');
const TREES = {
  base: path.join(REPO, 'probe-dist-base', 'src', 'config', 'managed-compatibility.js'),
  head: path.join(REPO, 'packages', 'cli', 'dist', 'src', 'config', 'managed-compatibility.js'),
};
const SETTINGS = pathToFileURL(path.join(REPO, 'packages', 'cli', 'dist', 'src', 'config', 'settings.js')).href;
const MCPCLIENT = pathToFileURL(path.join(REPO, 'packages', 'core', 'dist', 'src', 'tools', 'mcp-client.js')).href;
const emit = (o) => console.log(`PROBE_JSON ${JSON.stringify(o)}`);
const ROOT = path.join(REPO, '..', 'pr12934-cases'); // same drive as the checkout (D:)
const LAUNCH = 'C:\\pr12934-launch';
emit({ case: 'runner', platform: os.platform(), release: os.release(), node: process.version, root: ROOT, launch: LAUNCH });

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
function run(cwd, env, args) {
  try {
    const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 240000, input: '' });
    if (r.error) return { refused: `${r.error.code ?? r.error.name}: ${r.error.message}` };
    return { out: strip(`${r.stdout ?? ''}${r.stderr ?? ''}`).trim(), code: r.status };
  } catch (e) {
    return { refused: `${e.name}${e.code ? ` ${e.code}` : ''}: ${e.message.slice(0, 110)}` };
  }
}
const inherited = {};
for (const [k, v] of Object.entries(process.env)) {
  if (!/^(QWEN_|HOME$|USERPROFILE$|TEMP$|TMP$|NO_COLOR$)/i.test(k)) inherited[k] = v;
}

const CASES = [
  { id: 'control: nothing configured', spec: () => ({}) },
  { id: 'control: absolute QWEN_HOME, extension installed', setup: 'ext:ws\\qh', spec: (c) => ({ own: { QWEN_HOME: `${c}\\ws\\qh` } }) },
  { id: "name with '=': {'QWEN_HOME=alt': 'home'}", setup: 'ext:alt=home', spec: () => ({ own: { 'QWEN_HOME=alt': 'home' } }) },
  { id: "{'0': ''} + user mcp.serverCommand '$0'", setup: 'user-settings:{"mcp":{"serverCommand":"$0"}}', spec: () => ({ own: { 0: '' } }), settingsOracle: true },
  { id: 'non-enumerable QWEN_HOME (empty store) + extension in ~\\.qwen', setup: 'ext:', spec: (c) => ({ hidden: { QWEN_HOME: `${c}\\ws\\empty` } }) },
  { id: "hidden-style name {'=C:': 'C:\\\\x'}", spec: () => ({ own: { '=C:': 'C:\\x' } }) },
  { id: 'first spelling undefined, qwen_home -> store with extension', setup: 'ext:ws\\qh', spec: (c) => ({ own: { QWEN_HOME: { $undefined: 1 }, qwen_home: `${c}\\ws\\qh` } }) },
  { id: "lower-case only relative qwen_home='qh'", setup: 'ext:qh', spec: () => ({ own: { qwen_home: 'qh' } }) },
  { id: "inherited relative QWEN_HOME='qh'", setup: 'ext:qh', spec: () => ({ proto: { QWEN_HOME: 'qh' } }) },
  { id: "QWEN_HOME='~qh'", setup: 'ext:~qh', spec: () => ({ own: { QWEN_HOME: '~qh' } }) },
  { id: 'USERPROFILE does not exist', spec: (c) => ({ own: { USERPROFILE: `${c}\\missing-home`, HOME: `${c}\\missing-home` } }), evalHome: (c) => `${c}\\missing-home` },
  { id: 'NUL byte in an unrelated value', spec: () => ({ own: { EXTRA: 'a\0b' } }) },
];

const counts = { base: 0, head: 0 };
for (const k of CASES) {
  const slug = k.id.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 60);
  const c = path.join(ROOT, slug);
  const launch = path.join(LAUNCH, slug);
  fs.rmSync(c, { recursive: true, force: true });
  for (const d of ['home\\.qwen', 'ws', 'ws\\empty', 'runtime', 'tmp']) fs.mkdirSync(path.join(c, d), { recursive: true });
  fs.mkdirSync(launch, { recursive: true });
  const base = { ...inherited, USERPROFILE: `${c}\\home`, HOME: `${c}\\home`, TEMP: `${c}\\tmp`, TMP: `${c}\\tmp`, NO_COLOR: '1',
    QWEN_RUNTIME_DIR: `${c}\\runtime`, QWEN_CODE_SYSTEM_SETTINGS_PATH: `${c}\\sys-settings.json`, QWEN_CODE_SYSTEM_DEFAULTS_PATH: `${c}\\sys-defaults.json` };
  const ws = path.join(c, 'ws');
  let setup = '';
  if (k.setup?.startsWith('ext:')) {
    const dir = k.setup.slice(4);
    const env = { ...base, ...(dir ? { QWEN_HOME: dir.startsWith('ws\\') ? `${c}\\${dir}` : dir } : {}) };
    const r = run(ws, env, [CLI, 'extensions', 'install', path.join(P, 'fixtures', 'ext-mcp'), '--consent']);
    const manifests = [];
    const walk = (d, depth) => { if (depth > 5) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (e.name === 'qwen-extension.json' && p.includes(`extensions${path.sep}mcp-ext`)) manifests.push(path.relative(c, path.dirname(path.dirname(path.dirname(p))))); } };
    walk(c, 0);
    setup = `store at ${manifests.join(', ') || '?'} · ${(r.out ?? r.refused ?? '').split('\n').pop()}`;
  }
  if (k.setup?.startsWith('user-settings:')) {
    fs.writeFileSync(path.join(c, 'home', '.qwen', 'settings.json'), k.setup.slice('user-settings:'.length));
    setup = `home\\.qwen\\settings.json = ${k.setup.slice('user-settings:'.length)}`;
  }
  const spec = { base, ...k.spec(c) };
  const specPath = path.join(c, 'spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec));
  let host;
  const h = run(ws, build(spec), [CLI, 'mcp', 'list']);
  if (h.refused) host = { refused: h.refused };
  else host = { servers: [...h.out.matchAll(/^\s*[✓✗…○●◌⏳]?\s*([\w-]+):\s/gm)].map((m) => m[1]), tail: h.out.split('\n').slice(-2).join(' | ').slice(0, 160), exit: h.code };
  if (k.settingsOracle) {
    const s = run(ws, build(spec), ['--input-type=module', '-e',
      `const { loadSettings } = await import(${JSON.stringify(SETTINGS)}); const { populateMcpServerCommand } = await import(${JSON.stringify(MCPCLIENT)});
       const cmd = loadSettings(process.cwd()).merged.mcp?.serverCommand;
       console.log(JSON.stringify({ serverCommand: cmd ?? null, servers: cmd ? populateMcpServerCommand({}, cmd) : {}, lookup0: process.env['0'] ?? null, keysHave0: Object.keys(process.env).includes('0') }));`]);
    host.settings = (s.out ?? s.refused).split('\n').pop();
    try { const j = JSON.parse(host.settings); if (Object.keys(j.servers).length) host.servers = [...(host.servers ?? []), ...Object.keys(j.servers).map((n) => `${n} (serverCommand)`)]; } catch {}
  }
  const hostConfigures = Array.isArray(host.servers) && host.servers.length > 0;
  const verdicts = {};
  for (const [tree, mod] of Object.entries(TREES)) {
    const evalEnv = { ...base, ...(k.evalHome ? { USERPROFILE: k.evalHome(c), HOME: k.evalHome(c) } : {}) };
    const r = run(launch, evalEnv, [path.join(P, 'eval-case.mjs'), mod, ws, specPath]);
    try { const j = JSON.parse(r.out); verdicts[tree] = j.status + (j.reason ? ` (${j.reason})` : ''); } catch { verdicts[tree] = `ERROR ${(r.out ?? r.refused).slice(0, 300)}`; }
  }
  const falseCompatible = Object.fromEntries(Object.keys(TREES).map((t) => [t, hostConfigures && verdicts[t].startsWith('compatible')]));
  for (const t of Object.keys(TREES)) counts[t] += falseCompatible[t] ? 1 : 0;
  emit({ part: 'host', id: k.id, setup, host, hostConfigures, ...verdicts, falseCompatible });
}
emit({ part: 'host', summary: true, cases: CASES.length, falseCompatible: counts });
