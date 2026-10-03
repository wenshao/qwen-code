// Native Windows probe for PR 13140: Workspace settings recovery through the installed CLI.
// Arms are npm global installs under %RUNNER_TEMP%\<arm>. One PROBE_JSON line per launch.
import { spawnSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RT = process.env.RUNNER_TEMP;
const ARMS = ['base', 'head'];
const MAL = '{"ui": {"hideTips": true, "secret": "AKIA-EXAMPLE-outside-bytes",\n';
const VALID = '{"ui": {"hideTips": true}}\n';
const sha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 8); } catch { return 'absent'; } };
const head = (f) => { try { return fs.readFileSync(f, 'utf8').slice(0, 20).replace(/\s+/g, ' '); } catch { return ''; } };
const ro = (f) => { try { return (fs.statSync(f).mode & 0o200) === 0; } catch { return null; } };
const cli = (arm) => path.join(RT, arm, 'node_modules', '@qwen-code', 'qwen-code', 'cli-entry.js');

function launch(arm, cwd, home) {
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, windir: process.env.windir,
    TEMP: process.env.TEMP, TMP: process.env.TMP, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT,
    USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(home, 'sys.json'), QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(home, 'sysdef.json'),
    NO_COLOR: '1', CI: '1',
  };
  const r = spawnSync(process.execPath, [cli(arm), '-p', 'hi', '--auth-type', 'openai', '--openai-api-key', 'dummy',
    '--openai-base-url', 'http://127.0.0.1:9/v1', '--model', 'fake-model'], { cwd, env, encoding: 'utf8', timeout: 90000 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  return {
    exit: r.status, signal: r.signal, timedOut: r.error?.code === 'ETIMEDOUT',
    started: /API Error|Connection error|fetch failed|ECONNREFUSED/i.test(out),
    linkedRefusal: /Linked Workspace settings cannot be recovered/.test(out),
    settingsError: /Please fix the configuration|Cannot preserve|Cannot read operator/.test(out),
    first: out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 220) ?? '',
    tail: out.trim().slice(-500),
  };
}

function fixture(name) {
  const root = path.join(RT, 'fx', name);
  fs.rmSync(root, { recursive: true, force: true });
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ws', '.qwen'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outside'), { recursive: true });
  return { root, home, ws: path.join(root, 'ws'), wsSettings: path.join(root, 'ws', '.qwen', 'settings.json') };
}

function emit(arm, caseName, extra, res, files) {
  const rec = { arm, case: caseName, ...extra, ...res };
  for (const [k, f] of Object.entries(files)) rec[k] = { sha: sha(f), head: head(f), readOnly: ro(f) };
  console.log('PROBE_JSON ' + JSON.stringify(rec));
}

console.log('PROBE_INFO ' + JSON.stringify({ node: process.version, os: os.release(), tmpdir: os.tmpdir(), runnerTemp: RT,
  versions: Object.fromEntries(ARMS.map((a) => [a, JSON.parse(fs.readFileSync(path.join(path.dirname(cli(a)), 'package.json'), 'utf8')).version])) }));

for (const arm of ARMS) {
  // W1: plain malformed Workspace settings, reached through several spellings of the same workspace.
  const variants = [];
  { const f = fixture(`${arm}-plain`); variants.push(['long-path', f, f.ws]); }
  { const base = fs.mkdtempSync(path.join(os.tmpdir(), `p13140-${arm}-`)); const f = { root: base, home: path.join(base, 'home'), ws: path.join(base, 'ws'), wsSettings: path.join(base, 'ws', '.qwen', 'settings.json') };
    fs.mkdirSync(path.join(f.home, '.qwen'), { recursive: true }); fs.mkdirSync(path.join(f.ws, '.qwen'), { recursive: true }); variants.push(['os.tmpdir 8.3', f, f.ws]); }
  { const f = fixture(`${arm}-lowerdrive`); variants.push(['lowercase drive', f, f.ws[0].toLowerCase() + f.ws.slice(1)]); }
  { const f = fixture(`${arm}-junction`); const j = path.join(f.root, 'ws-junction'); fs.symlinkSync(f.ws, j, 'junction'); variants.push(['junction cwd', f, j]); }
  { const f = fixture(`${arm}-subst`); let drive = null;
    for (const d of ['Q:', 'R:', 'S:']) { try { execSync(`subst ${d} "${f.root}"`); drive = d; break; } catch {} }
    if (drive) variants.push([`subst ${drive}`, { ...f, substDrive: drive }, `${drive}\\ws`]); }
  for (const [label, f, cwd] of variants) {
    fs.writeFileSync(f.wsSettings, MAL);
    const before = sha(f.wsSettings);
    const res = launch(arm, cwd, f.home);
    emit(arm, 'W1 malformed plain', { variant: label, cwd, before }, res, { settings: f.wsSettings, copy: f.wsSettings + '.corrupted' });
    if (f.substDrive) { try { execSync(`subst ${f.substDrive} /d`); } catch {} }
  }
  // W2: symlink to a malformed file outside the workspace.
  { const f = fixture(`${arm}-symlink`); const out = path.join(f.root, 'outside', 'shared.json'); fs.writeFileSync(out, MAL); fs.symlinkSync(out, f.wsSettings, 'file');
    const res = launch(arm, f.ws, f.home); emit(arm, 'W2 symlink to outside', {}, res, { outside: out, copy: f.wsSettings + '.corrupted' }); }
  // W3: hard link shared with an outside file.
  { const f = fixture(`${arm}-hardlink`); const out = path.join(f.root, 'outside', 'shared.json'); fs.writeFileSync(out, MAL); fs.linkSync(out, f.wsSettings);
    const res = launch(arm, f.ws, f.home); emit(arm, 'W3 hard link', {}, res, { outside: out, copy: f.wsSettings + '.corrupted' }); }
  // W4: read-only malformed settings.json, three launches.
  { const f = fixture(`${arm}-readonly`); fs.writeFileSync(f.wsSettings, MAL); fs.chmodSync(f.wsSettings, 0o444);
    for (const n of [1, 2, 3]) { const res = launch(arm, f.ws, f.home); emit(arm, 'W4 read-only', { launch: n }, res, { settings: f.wsSettings, copy: f.wsSettings + '.corrupted' }); } }
  // W5: malformed operator (User) settings.
  { const f = fixture(`${arm}-operator`); const user = path.join(f.home, '.qwen', 'settings.json'); fs.writeFileSync(user, '{"tools": {"executionSandbox": {"backend": "bwrap",\n');
    const res = launch(arm, f.ws, f.home); emit(arm, 'W5 operator User malformed', {}, res, { user }); }
  // W6: control, valid Workspace JSON.
  { const f = fixture(`${arm}-valid`); fs.writeFileSync(f.wsSettings, VALID);
    const res = launch(arm, f.ws, f.home); emit(arm, 'W6 valid control', {}, res, { settings: f.wsSettings }); }
}
