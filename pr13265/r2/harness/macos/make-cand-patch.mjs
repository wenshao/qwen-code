// Writes the round-2 candidate edits into a checkout's hook-command-cgroup.ts:
//  1. attach(): the name check intended a NUL ('\0'), not the empty string;
//  2. attach(): an unusable root answers the isolation error (not ENOENT);
//  3. terminate(): after cgroup.kill, wait for the unit to empty;
//  4. launcher: a command that dies by a signal re-raises it, so the
//     supervisor's exit evidence carries the signal instead of exit code 1.
import fs from 'node:fs';
const f = process.argv[2];
const BS = String.fromCharCode(92);
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`anchor x${n}: ${a.slice(0, 60)}`);
  s = s.replace(a, () => b);
};
rep(
  `    const resolved = HookCommandCgroup.resolveRoot(root);\n    if (unitName.includes('/') || unitName.includes('')) return undefined;`,
  `    let resolved: string;\n    try {\n      resolved = HookCommandCgroup.resolveRoot(root);\n    } catch {\n      throw new HookCommandIsolationUnavailableError();\n    }\n    if (unitName.includes('/') || unitName.includes('${BS}0')) return undefined;`,
);
rep(
  `    if (!(await this.waitForEmpty(graceMs))) this.kill();`,
  `    if (!(await this.waitForEmpty(graceMs))) {\n      this.kill();\n      await this.waitForEmpty(1_000);\n    }`,
);
rep(
  `child.on('exit', (code) => process.exit(code ?? 1));`,
  `child.on('exit', (code, signal) => {\n  if (signal) {\n    process.removeAllListeners(signal);\n    process.kill(process.pid, signal);\n    setTimeout(() => process.exit(1), 1000);\n  } else process.exit(code ?? 1);\n});`,
);
fs.writeFileSync(f, s);
console.log('patched', f);
