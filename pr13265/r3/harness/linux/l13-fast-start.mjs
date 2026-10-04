// PR #13265 round 3 — L13: does supervisor.start() prove membership for a
// command that finishes quickly? Each trial runs a command with a visible
// side effect (a marker file), then records whether start() claimed the
// process never started, whether the side effect happened anyway, and
// whether the unit directory was left behind.
import fs from 'node:fs';
import path from 'node:path';

const DIST = process.env.DIST;
const ROOT = process.env.CGROUP_ROOT;
const N = Number(process.env.N ?? 30);
const { ManagedChildRunSupervisor } = await import(`${DIST}/core/managed-runtime/managed-child-run-supervisor.js`);
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
const dir = '/tmp/l13';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir);
const variants = {
  'touch; exit 0': (m) => `touch ${m}; exit 0`,
  'touch; sleep 0.3': (m) => `touch ${m}; sleep 0.3`,
  'touch; (sleep 30 &); exit 0': (m) => `touch ${m}; (sleep 30 &); exit 0`,
};
const out = {};
for (const [label, cmd] of Object.entries(variants)) {
  const tally = { started: 0, refusedAsIsolation: 0, refusedButRan: 0, unitLeftAfterRefusal: 0, liveMembersInLeftUnit: 0 };
  for (let i = 0; i < N; i++) {
    const name = `qwen-bg-l13-${label.replace(/[^a-z0-9]/g, '')}-${i}`;
    const marker = path.join(dir, `${name}.marker`);
    try {
      const p = await sup.start({ unitName: name, executable: '/bin/sh', args: ['-c', cmd(marker)], env: { PATH: process.env.PATH }, cwd: '/tmp', onOutput: () => {} });
      tally.started++;
      await new Promise((r) => (p.exited ? r() : p.child.once('exit', r)));
    } catch (e) {
      tally.refusedAsIsolation += e?.name === 'HookCommandIsolationUnavailableError' ? 1 : 0;
      await new Promise((r) => setTimeout(r, 100));
      if (fs.existsSync(marker)) tally.refusedButRan++;
      const unit = path.join(ROOT, name);
      if (fs.existsSync(unit)) {
        tally.unitLeftAfterRefusal++;
        const procs = fs.readFileSync(path.join(unit, 'cgroup.procs'), 'utf8').trim();
        if (procs) tally.liveMembersInLeftUnit++;
      }
    }
  }
  out[label] = tally;
  console.log(`[${label}] ${JSON.stringify(tally)}`);
}
console.log(`[RESULT] ${JSON.stringify(out)}`);
// clean up every unit this probe made
for (const d of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-bg-l13-'))) {
  try { fs.writeFileSync(path.join(ROOT, d, 'cgroup.kill'), '1'); } catch {}
}
await new Promise((r) => setTimeout(r, 500));
for (const d of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-bg-l13-'))) {
  try { fs.rmdirSync(path.join(ROOT, d)); } catch {}
}
process.exit(0);
