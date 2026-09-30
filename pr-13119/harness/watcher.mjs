// Live process: real loadSettings + real SettingsWatcher (chokidar) from the arm's compiled CLI.
// A separate process saves user settings 5 times through the same arm's real writer.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const arm = process.argv[2];
const D = `/root/verify/pr13119/run/watch-${arm}`;
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(`${D}/qh`, { recursive: true }); fs.mkdirSync(`${D}/ws/.qwen`, { recursive: true });
process.env.QWEN_HOME = `${D}/qh`;
process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH = '/nonexistent/s.json';
process.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH = '/nonexistent/d.json';
const initial = { $version: 4, ui: { theme: 'GitHub' } };
fs.writeFileSync(`${D}/qh/settings.json`, JSON.stringify(initial, null, 2));
const dist = `/root/verify/pr13119/${arm}/packages/cli/dist/src/config`;
const { loadSettings } = await import(`${dist}/settings.js`);
const { SettingsWatcher } = await import(`${dist}/settingsWatcher.js`);
const settings = loadSettings(`${D}/ws`);
const watcher = new SettingsWatcher(settings);
const batches = [];
watcher.addChangeListener((events) => { batches.push(events.map((e) => `${e.changeType}:${e.path.replace(D + '/', '')}`)); });
watcher.startWatching();
await new Promise((r) => setTimeout(r, 1500));
const themes = ['Dracula', 'ANSI', 'Atom One', 'Ayu', 'GitHub'];
const seen = [];
for (const theme of themes) {
  execFileSync('node', ['--input-type=module', '-e', `
    const m = await import('/root/verify/pr13119/${arm}/packages/cli/dist/src/utils/jsonc-editor.js');
    m.updateSettingsFilePreservingFormat(process.argv[1], { $version: 4, ui: { theme: process.argv[2] } });
  `, `${D}/qh/settings.json`, theme], { input: '', env: process.env, stdio: ['ignore', 'inherit', 'inherit'] , });
  await new Promise((r) => setTimeout(r, 1200));
  seen.push(settings.merged.ui?.theme);
}
watcher.stopWatching();
console.log(JSON.stringify({ arm, batches: batches.length, perBatch: batches.map((b) => b.join(',')), inMemoryThemeAfterEachSave: seen, leftovers: fs.readdirSync(`${D}/qh`).filter((n) => n.startsWith('settings.json.')) }));
process.exit(0);
