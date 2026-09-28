// Real-environment probe for PR 12883 on a Windows runner: the built
// evaluation against real files and the real CLI's extension store.
// Prints one `PROBE_JSON {...}` line per case.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const CLI = path.join(REPO, 'dist', 'cli.js');
const { evaluateManagedCompatibility } = await import(
  pathToFileURL(path.join(REPO, 'packages/cli/dist/src/config/managed-compatibility.js')).href
);
const ROOT = path.join(os.tmpdir(), 'pr12883-probe');
fs.rmSync(ROOT, { recursive: true, force: true });

function fingerprint(roots) {
  const out = new Map();
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p, { bigint: true }); } catch (e) { out.set(p, `ERR:${e.code}`); return; }
    const type = st.isDirectory() ? 'd' : st.isFile() ? 'f' : st.isSymbolicLink() ? 'l' : 'o';
    let extra = '';
    if (type === 'f') { try { extra = createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16); } catch (e) { extra = `unreadable:${e.code}`; } }
    if (type === 'l') extra = fs.readlinkSync(p);
    out.set(p, `${type} ${st.size} ${st.ino} ${st.mtimeNs} ${st.ctimeNs} ${extra}`);
    if (type === 'd') for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n));
  };
  for (const r of roots) walk(r);
  return out;
}
const changes = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).map((k) => path.relative(ROOT, k));

function makeCase(name) {
  const dir = path.join(ROOT, name);
  for (const d of ['home/.qwen', 'ws', 'sys', 'runtime']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const env = {
    ...process.env,
    HOME: path.join(dir, 'home'), USERPROFILE: path.join(dir, 'home'),
    QWEN_HOME: path.join(dir, 'home', '.qwen'), QWEN_RUNTIME_DIR: path.join(dir, 'runtime'),
    QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(dir, 'sys', 'settings.json'),
  };
  return { dir, ws: path.join(dir, 'ws'), env };
}
async function evaluate(c, extra = {}) {
  const env0 = JSON.stringify(process.env);
  const before = fingerprint([c.dir]);
  const r = await evaluateManagedCompatibility(
    { workspaceCwd: c.ws, ...(extra.mode ? { approvalMode: extra.mode } : {}) },
    { workspaceCwd: c.ws, workspaceTrusted: true, environment: extra.environment ?? c.env, forwardedArgs: [], hasLiveMcpServers: () => false },
  );
  const writes = changes(before, fingerprint([c.dir]));
  return { result: r.status + (r.reason ? ` - ${r.reason}` : ''), evalWrites: writes.length, envChanged: JSON.stringify(process.env) !== env0 };
}
function qwen(c, args, input = '') {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: c.ws, env: c.env, input, encoding: 'utf8', timeout: 120000 });
  return `${r.status}: ${((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n').pop()}`;
}
const emit = (o) => console.log(`PROBE_JSON ${JSON.stringify(o)}`);
const j = (o) => JSON.stringify(o, null, 2);

// 1. Real extension store lifecycle through the real CLI.
{
  const c = makeCase('lifecycle');
  const ext = path.join(ROOT, 'ext-hello');
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'qwen-extension.json'), j({ name: 'hello-ext', version: '1.0.0' }));
  emit({ case: 'lifecycle: fresh home', ...(await evaluate(c)) });
  const init = qwen(c, ['extensions', 'list']);
  emit({ case: 'lifecycle: after `extensions list` initialized the store', cli: init, ...(await evaluate(c)) });
  const ins = qwen(c, ['extensions', 'install', ext, '--consent']);
  emit({ case: 'lifecycle: after install', cli: ins, ...(await evaluate(c)) });
  const dis = qwen(c, ['extensions', 'disable', 'hello-ext']);
  emit({ case: 'lifecycle: after disable', cli: dis, ...(await evaluate(c)) });
  const un = qwen(c, ['extensions', 'uninstall', 'hello-ext']);
  emit({ case: 'lifecycle: after uninstall', cli: un, ...(await evaluate(c)) });
  const link = qwen(c, ['extensions', 'link', ext], 'y\n');
  emit({ case: 'lifecycle: after link', cli: link, ...(await evaluate(c)) });
  const unl = qwen(c, ['extensions', 'uninstall', 'hello-ext']);
  emit({ case: 'lifecycle: after uninstall of link', cli: unl, ...(await evaluate(c)) });
  // The documented Windows risk: a locating variable spelled in another case.
  const cv = makeCase('casevariant');
  const alt = path.join(cv.dir, 'alt');
  const lower = { ...cv.env }; delete lower.QWEN_HOME; lower.qwen_home = alt;
  const ins2 = qwen({ ...cv, env: lower }, ['extensions', 'install', ext, '--consent']);
  emit({ case: 'case-variant qwen_home: CLI child install', cli: ins2,
    landedInAlt: fs.existsSync(path.join(alt, 'extensions', 'hello-ext')),
    landedInHome: fs.existsSync(path.join(cv.dir, 'home', '.qwen', 'extensions', 'hello-ext')) });
  emit({ case: 'case-variant qwen_home: evaluation given {qwen_home: alt}', probeHomedir: os.homedir(), ...(await evaluate(cv, { environment: lower })) });
  emit({ case: 'case-variant qwen_home: evaluation given {QWEN_HOME: alt}', ...(await evaluate(cv, { environment: { ...cv.env, QWEN_HOME: alt } })) });
}

// 2. Settings and .mcp.json on real files: evaluation vs the ordinary loader.
const F = [
  ['user v1 legacy keys', { 'home/.qwen/settings.json': j({ theme: 'GitHub', autoAccept: false }) }],
  ['user BOM + comments', { 'home/.qwen/settings.json': '﻿// c\n{ "$version": 4, "ui": { "theme": "GitHub" } }\n' }],
  ['user v1 approvalMode plan', { 'home/.qwen/settings.json': j({ approvalMode: 'plan' }) }],
  ['user hooks', { 'home/.qwen/settings.json': j({ $version: 4, hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo hi' }] }] } }) }],
  ['workspace settings corrupt JSON', { 'ws/.qwen/settings.json': '{ "ui": ' }],
  ['user settings dangling symlink', { 'home/.qwen/settings.json': { link: 'missing.json' } }],
  ['.mcp.json with a server', { 'ws/.mcp.json': j({ mcpServers: { s: { command: 'cmd.exe' } } }) }],
  ['.mcp.json is a directory', { 'ws/.mcp.json/': null }],
  ['.mcp.json {"mcpServers":{}}', { 'ws/.mcp.json': j({ mcpServers: {} }) }],
];
for (const [name, files] of F) {
  const slug = name.replace(/[^a-z0-9]+/gi, '-');
  const e = makeCase(`${slug}-eval`), l = makeCase(`${slug}-loader`);
  let skipped;
  for (const c of [e, l]) for (const [rel, content] of Object.entries(files)) {
    const p = path.join(c.dir, rel);
    if (rel.endsWith('/')) { fs.mkdirSync(p, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (content && typeof content === 'object') { try { fs.symlinkSync(content.link, p, 'file'); } catch (err) { skipped = err.code; } }
    else fs.writeFileSync(p, content);
  }
  if (skipped) { emit({ case: name, skipped }); continue; }
  const ev = await evaluate(e);
  const before = fingerprint([l.dir]);
  const cli = qwen(l, ['mcp', 'list']);
  const loaderWrites = changes(before, fingerprint([l.dir])).filter((p) => !/extension|runtime/.test(p) && !/[\\/]\.qwen$/.test(p));
  emit({ case: name, ...ev, loader: cli, loaderWrites });
}
