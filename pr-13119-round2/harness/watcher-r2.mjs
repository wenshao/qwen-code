// Live real SettingsWatcher (chokidar) from head2's compiled CLI, clean vs the R1-1b mutant
// (any unlinkDir demotes). The mutant is a sibling copy of the compiled module, so dist is untouched.
// Each round: a separate process saves via the real writer, then ~30 ms later an external editor
// rewrites settings.json in place. We record whether memory ends on the editor's value.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const variant = process.argv[2]; // clean | mutant
const dist = '/root/verify/pr13119/head2/packages/cli/dist/src/config';
let mod = `${dist}/settingsWatcher.js`;
if (variant === 'mutant') {
  const src = fs.readFileSync(mod, 'utf8');
  const old = "if (event === 'unlinkDir' && changedPath === dir) {";
  if (!src.includes(old)) throw new Error('pattern');
  mod = `${dist}/settingsWatcher.r2mut.js`;
  fs.writeFileSync(mod, src.replace(old, "if (event === 'unlinkDir') {"));
}
const D = `/root/verify/pr13119/r2/watch-${variant}`;
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(`${D}/qh`, { recursive: true }); fs.mkdirSync(`${D}/ws/.qwen`, { recursive: true });
Object.assign(process.env, { QWEN_HOME: `${D}/qh`, QWEN_CODE_SYSTEM_SETTINGS_PATH: '/nonexistent/s.json', QWEN_CODE_SYSTEM_DEFAULTS_PATH: '/nonexistent/d.json' });
const T = `${D}/qh/settings.json`;
fs.writeFileSync(T, JSON.stringify({ $version: 4, ui: { theme: 'GitHub' } }, null, 2));
const { loadSettings } = await import(`${dist}/settings.js`);
const { SettingsWatcher } = await import(mod);
let demotes = 0;
const orig = SettingsWatcher.prototype.demoteScope;
SettingsWatcher.prototype.demoteScope = function (...a) { demotes++; return orig.apply(this, a); };
const settings = loadSettings(`${D}/ws`);
const watcher = new SettingsWatcher(settings);
let batches = 0; watcher.addChangeListener(() => batches++);
watcher.startWatching();
await new Promise((r) => setTimeout(r, 1500));
const rounds = [];
for (let i = 0; i < 8; i++) {
  execFileSync('node', ['--input-type=module', '-e', `
    const m = await import('/root/verify/pr13119/head2/packages/cli/dist/src/utils/jsonc-editor.js');
    m.updateSettingsFilePreservingFormat(process.argv[1], { $version: 4, ui: { theme: 'saved-${i}' } });`, T], { stdio: 'inherit' });
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(T, JSON.stringify({ $version: 4, ui: { theme: `editor-${i}` } }, null, 2)); // in-place external edit
  await new Promise((r) => setTimeout(r, 1500));
  rounds.push(settings.merged.ui?.theme);
}
// Long-lived private dir (a retained recovery copy, or a crash leftover the user later deletes): created,
// left 800 ms so chokidar registers it, then removed; then an external edit.
const demotesBefore = demotes;
fs.mkdirSync(`${T}.write-Long01`); fs.writeFileSync(`${T}.write-Long01/settings.json.orig`, '{}');
await new Promise((r) => setTimeout(r, 800));
fs.rmSync(`${T}.write-Long01`, { recursive: true });
await new Promise((r) => setTimeout(r, 1500));
fs.writeFileSync(T, JSON.stringify({ $version: 4, ui: { theme: 'editor-after-long' } }, null, 2));
await new Promise((r) => setTimeout(r, 1500));
const longDir = { demoteScopeCalls: demotes - demotesBefore, memoryAfterEdit: settings.merged.ui?.theme };
// Positive control for the demote counter: remove the watched directory itself.
const before2 = demotes; fs.rmSync(`${D}/qh`, { recursive: true }); await new Promise((r) => setTimeout(r, 1500));
const positiveControl = { demoteScopeCallsOnQwenDirRemoval: demotes - before2 };
watcher.stopWatching();
if (variant === 'mutant') fs.rmSync(mod);
const missed = rounds.filter((t, i) => t !== `editor-${i}`).length;
console.log(JSON.stringify({ variant, saves: rounds.length, demoteScopeCalls: demotes, changeBatches: batches, memoryAfterEachRound: rounds, externalEditsMissed: missed, longDir, positiveControl }));
process.exit(0);
