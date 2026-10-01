// Round 2: single-file bind mount of settings.json (rename -> EBUSY on every save), REAL bundled CLI.
// Must run inside a private mount namespace (bindmount-r2.sh). For each arm and scenario:
//   startups : 3 x `qwen sandbox` -> each start tries the $version normalisation save and fails
//   other-writer : pause the real writer right after its backup copy; another writer then changes the
//                  bind-mounted target in place (the only way anything can publish there); release.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '/root/verify/pr13119';
const [arm, scenario] = process.argv.slice(2);
const D = `${ROOT}/r2/bm-${arm}-${scenario}`;
fs.rmSync(D, { recursive: true, force: true });
for (const d of ['host', 'qh', 'ws', 'ctl']) fs.mkdirSync(`${D}/${d}`, { recursive: true });
const OLD = fs.readFileSync(`${ROOT}/run/bm2/host/settings.json`, 'utf8'); // $version 3 -> normalisation save
fs.writeFileSync(`${D}/host/settings.json`, OLD);
fs.writeFileSync(`${D}/qh/settings.json`, '');
execFileSync('mount', ['--bind', `${D}/host/settings.json`, `${D}/qh/settings.json`]);
const TARGET = `${D}/qh/settings.json`;
const env = { ...process.env, HOME: `${ROOT}/run/home`, QWEN_HOME: `${D}/qh`,
  QWEN_CODE_SYSTEM_SETTINGS_PATH: '/nonexistent/s.json', QWEN_CODE_SYSTEM_DEFAULTS_PATH: '/nonexistent/d.json',
  QWEN_CODE_NO_RELAUNCH: '1', QWEN_SANDBOX: 'false', TERM: 'xterm-256color', QWEN_DEBUG_LOG_FILE: '1' };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_COLOR', 'NODE_OPTIONS']) delete env[k];
const leftovers = () => fs.readdirSync(`${D}/qh`).filter((n) => n.startsWith('settings.json.')).sort()
  .map((n) => { const p = `${D}/qh/${n}`; const inner = fs.readdirSync(p).sort();
    return { dir: n, files: inner, copies: Object.fromEntries(inner.map((f) => [f, fs.readFileSync(`${p}/${f}`, 'utf8') === OLD ? 'identical to pre-save target' : 'other bytes'])) }; });
const debugHits = () => { try { return execFileSync('grep', ['-rhE', 'on disk|Recovery copy', `${D}/qh`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((l) => l.replace(D, '<D>').replace(D, '<D>').slice(0, 400)); } catch { return []; } };
function cli(args, extraEnv = {}, onCkpt) {
  return new Promise((resolve) => {
    const child = spawn('node', args[0] === '-e' ? args : [`${ROOT}/${arm}/dist/cli.js`, ...args], { cwd: `${D}/ws`, env: { ...env, ...extraEnv } });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    let done = false; child.on('close', (code) => { done = true; resolve({ code, out }); });
    if (onCkpt) (async () => { let n = 1; while (!done) { const ck = `${D}/ctl/ckpt-${n}.json`;
      if (!fs.existsSync(ck)) { await new Promise((r) => setTimeout(r, 15)); continue; }
      await new Promise((r) => setTimeout(r, 20)); onCkpt(JSON.parse(fs.readFileSync(ck, 'utf8')), n);
      fs.writeFileSync(`${D}/ctl/release-${n}`, ''); n++; } })();
  });
}
const rows = [];
if (scenario === 'startups') {
  for (let i = 1; i <= 3; i++) {
    const r = await cli(['sandbox']);
    rows.push({ startup: i, rc: r.code, out: r.out.trim().split('\n').slice(0, 2).join(' / ').slice(0, 200),
      leftoverDirs: leftovers().length, targetVersion: (fs.readFileSync(TARGET, 'utf8').match(/"\$version": (\d)/) || [])[1] });
  }
} else {
  const B = OLD.replace('"GitHub"', '"edited-by-writer-B"');
  const ops = [];
  // other-writer: the real CLI startup save; other-writer-module: the arm's compiled writer called directly,
  // so the thrown message (which the CLI only sends to its debug log) can be shown verbatim.
  const MOD = `${ROOT}/${arm}/packages/cli/dist/src/utils/${fs.existsSync(`${ROOT}/${arm}/packages/cli/dist/src/utils/write-with-backup.js`) ? 'write-with-backup' : 'writeWithBackup'}.js`;
  const args = scenario === 'other-writer-module'
    ? ['-e', `import(${JSON.stringify(MOD)}).then((m) => { try { m.writeWithBackupSync(${JSON.stringify(TARGET)}, '{"$version": 4}\\n'); console.log('saved'); } catch (e) { console.log('THROWN: ' + e.message); } })`]
    : ['sandbox'];
  const r = await cli(args, { NODE_OPTIONS: `--require ${ROOT}/harness/pause-hook.cjs`, PAUSE_TARGET: TARGET, PAUSE_CTL: `${D}/ctl` },
    (desc, n) => { ops.push(`#${n} ${desc.op}`);
      if (desc.op === 'copyFileSync' && !ops.includes('B')) { fs.writeFileSync(TARGET, B); ops.push('B'); } });
  rows.push({ rc: r.code, thrown: (r.out.match(/THROWN: .*/) || [''])[0].split(D).join('<D>'), fsOps: ops.join(', ').replace(', B', ' -> writer B rewrites target in place'),
    targetAfter: fs.readFileSync(TARGET, 'utf8') === B ? "writer B's bytes (not rolled back)" : 'OTHER' });
}
const result = { arm, scenario, rows, leftovers: leftovers(), debugLog: debugHits() };
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(`${ROOT}/r2/result-bm-${arm}-${scenario}.json`, JSON.stringify(result, null, 2));
execFileSync('umount', [TARGET]);
