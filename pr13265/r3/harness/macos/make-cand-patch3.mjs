// Round-3 candidate edits against 210847dd0e (run from the repo root of a checkout):
//  hook-command-cgroup.ts
//   1. the unit-name check meant NUL ('\0'), not the empty string — both sites;
//   2. the launcher acknowledges membership on fd 3 ('joined') right after it
//      joins, so the supervisor has a positive signal even if the command
//      exits before cgroup.procs is read;
//   3. a command that dies by a signal re-raises it in the launcher;
//   4. terminate(): after cgroup.kill, wait for the unit to empty.
//  managed-child-run-supervisor.ts
//   5. prove(): a 'joined' acknowledgement proves membership;
//   6. the process object (and its exit listener) exists before the proof.
import fs from 'node:fs';
const BS = String.fromCharCode(92);
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b, count = 1] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== count) throw new Error(`${file}: expected ${count}× ${a.slice(0, 60)}, found ${n}`);
    s = s.split(a).join(b);
  }
  fs.writeFileSync(file, s);
  console.log('patched', file);
};
edit('packages/core/src/hooks/hook-command-cgroup.ts', [
  [`unitName.includes('')`, `unitName.includes('${BS}0')`, 2],
  [
    `  writeSync(3, 'unavailable${BS}n');\n  process.exit(1);\n}\n`,
    `  writeSync(3, 'unavailable${BS}n');\n  process.exit(1);\n}\ntry {\n  writeSync(3, 'joined${BS}n');\n} catch {\n  // A caller without the status channel only reads the failure.\n}\n`,
  ],
  [
    `child.on('exit', (code) => process.exit(code ?? 1));`,
    `child.on('exit', (code, signal) => {\n  if (signal) {\n    process.removeAllListeners(signal);\n    process.kill(process.pid, signal);\n    setTimeout(() => process.exit(1), 1000);\n  } else process.exit(code ?? 1);\n});`,
  ],
  [
    `    if (!(await this.waitForEmpty(graceMs))) this.kill();`,
    `    if (!(await this.waitForEmpty(graceMs))) {\n      this.kill();\n      await this.waitForEmpty(1_000);\n    }`,
  ],
]);
edit('packages/core/src/managed-runtime/managed-child-run-supervisor.ts', [
  [
    `    if (!(await prove(child, unit))) {
      child.kill('SIGKILL');
      unit.remove();
      throw new HookCommandIsolationUnavailableError();
    }
    const process_ = new ManagedChildRunProcess(spec.unitName, unit, child);
`,
    `    // Listen for the exit before awaiting the proof: a command that ends
    // inside the proof window must not lose its exit evidence.
    const process_ = new ManagedChildRunProcess(spec.unitName, unit, child);
    if (!(await prove(child, unit))) {
      child.kill('SIGKILL');
      unit.remove();
      throw new HookCommandIsolationUnavailableError();
    }
`,
  ],
  [
    `          if (status.includes('unavailable${BS}n')) return false;`,
    `          if (status.includes('unavailable${BS}n')) return false;\n          if (status.includes('joined${BS}n')) return true;`,
  ],
]);
