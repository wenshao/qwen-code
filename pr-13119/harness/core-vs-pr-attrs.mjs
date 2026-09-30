import fs from 'node:fs';
const { atomicWriteFileSync } = await import('/root/verify/pr13119/head/packages/core/dist/src/utils/atomicFileWrite.js');
const { writeWithBackupSync } = await import('/root/verify/pr13119/head/packages/cli/dist/src/utils/write-with-backup.js');
const D = '/root/verify/pr13119/run/core-attrs';
for (const [name, write] of [['PR writeWithBackupSync', (p, c) => writeWithBackupSync(p, c)], ['core atomicWriteFileSync (defaults)', (p, c) => atomicWriteFileSync(p, c)]]) {
  const f = `${D}/qh/settings.json`, dot = `${D}/dot/settings.json`;
  for (const p of [f, dot]) fs.rmSync(p, { force: true });
  fs.writeFileSync(f, '{"a":1}'); fs.chmodSync(f, 0o600);
  write(f, '{"a":2}');
  const mode = (fs.statSync(f).mode & 0o777).toString(8);
  fs.rmSync(f); fs.writeFileSync(dot, '{"a":1}'); fs.symlinkSync(dot, f);
  write(f, '{"a":2}');
  console.log(`${name}: 0600 -> ${mode}; symlink kept=${fs.lstatSync(f).isSymbolicLink()}; dotfile updated=${fs.readFileSync(dot, 'utf8') === '{"a":2}'}; leftovers=${fs.readdirSync(`${D}/qh`).filter((n) => n !== 'settings.json').length}`);
}
