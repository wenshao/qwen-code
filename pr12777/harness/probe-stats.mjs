// Runs the case file through the instrumented PR module and prints what the catch saw.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const mod = process.argv[2];
for (const f of process.argv.slice(3)) {
  const code = `globalThis.__catchStats = undefined; process.argv[2] = ${JSON.stringify(mod)}; process.argv[3] = ${JSON.stringify(f)};
    const w = process.stdout.write.bind(process.stdout); process.stdout.write = () => true;
    await import(${JSON.stringify(new URL('./child.mjs', import.meta.url).href)});
    process.stdout.write = w; w(${JSON.stringify(f)} + " " + JSON.stringify(globalThis.__catchStats) + String.fromCharCode(10));`;
  const r = spawnSync(process.execPath, ['--import', './register.mjs', '--input-type=module', '-e', code], { encoding: 'utf8' });
  process.stdout.write(r.stdout); if (r.status) process.stdout.write(r.stderr.slice(0, 2000));
}
