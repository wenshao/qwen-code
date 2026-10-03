// Witness for the two surviving mutants: exact-duplicate manifest names in two directories.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const home = mkdtempSync(join(tmpdir(), 'pr12640-dup-'));
process.env.QWEN_HOME = home;
const mk = (dir, skill) => { const d = join(home, 'extensions', dir); mkdirSync(join(d, 'skills', skill), { recursive: true });
  writeFileSync(join(d, 'qwen-extension.json'), JSON.stringify({ name: 'dup', version: '1.0.0' }));
  writeFileSync(join(d, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: x\n---\nx\n`); };
mk('dup-a', 'dup-a-skill'); mk('dup-b', 'dup-b-skill');
const { ExtensionManager } = await import('/root/verify/pr12640/head/packages/core/dist/index.js');
const ws = mkdtempSync(join(tmpdir(), 'pr12640-dup-ws-'));
const mgr = new ExtensionManager({ workspaceDir: ws, isWorkspaceTrusted: true });
await mgr.refreshCache();
const full = mgr.getLoadedExtensions().map((e) => `${e.path.split('/').pop()}:${e.skills.map((s) => s.name)}`);
const cat = (await new ExtensionManager({ workspaceDir: ws, isWorkspaceTrusted: true }).refreshCatalogSnapshot()).extensions.map((e) => e.path.split('/').pop());
const m3 = new ExtensionManager({ workspaceDir: ws, isWorkspaceTrusted: true });
const det = (await m3.refreshExtensionDetailsSnapshot('dup')).extension;
const loaded = await m3.loadExtensionsFromExtensionsDir(m3.configDir, ws, { detailName: 'dup' });
console.log(JSON.stringify({
  fullStatus: full,
  catalogBeforeSummaryDedup: cat,
  detailsFindLast: `${det.path.split('/').pop()}:${det.skills.map((s) => s.name)}`,
  detailsIfFind: (() => { const e = loaded.find((x) => x.name === 'dup'); return `${e.path.split('/').pop()}:${e.skills.map((s) => s.name)}`; })(),
}));
