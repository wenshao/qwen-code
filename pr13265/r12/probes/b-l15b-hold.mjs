// PR #13265 round 9 — L15b (H7b/H5, 2a3688d703 "demand unit emptiness before
// settling a natural end"): a background Shell whose launcher exits while a
// member it left behind keeps running, through the real registry and
// supervisor on cgroup v2. While the member lives: is the hold kept and no
// exit answered? Once the member dies: does the hold release with the exit
// evidence and the unit removed? A control without a leftover member.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.CGROUP_ROOT;
const { ManagedChildRunSupervisor } = await import('@qwen-code/qwen-code-core/managed-runtime/managed-child-run-supervisor.js');
const { ManagedBackgroundShellRegistry } = await import('@armcli/serve/managed-background-shell-registry.js');
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = (name) => {
  try {
    return fs.readFileSync(path.join(ROOT, name, 'cgroup.procs'), 'utf8').split('\n').map(Number).filter((n) => n > 1);
  } catch {
    return [];
  }
};

async function scenario(label, cmd, watchMs) {
  const name = `qwen-bg-l15b-${label}`;
  const calls = [];
  const sink = {
    write: () => {},
    setStarted: () => {},
    setProcessResult: () => {},
    finish: async (s, eof) => calls.push(`finish(${s},${eof})`),
    finalize: async (status) => { calls.push(`finalize(${status})`); return { executionStatus: status }; },
  };
  const reg = new ManagedBackgroundShellRegistry();
  const p = await sup.start({ unitName: name, executable: '/bin/sh', args: ['-c', cmd], env: { PATH: process.env.PATH }, cwd: '/tmp', onOutput: () => {} });
  const t0 = Date.now();
  let settledAt = null;
  let receipt = null;
  const registered = reg
    .register({ unitName: name, sessionId: `s-${label}`, process: p, sink, publisher: { finish: async () => calls.push('publisher.finish') }, identity: {} })
    .then((r) => { settledAt = Date.now(); receipt = r; });
  await sleep(watchMs);
  const during = {
    atMs: Date.now() - t0,
    holdKept: reg.hasHolds(`s-${label}`),
    settled: settledAt !== null,
    settledAfterMs: settledAt === null ? null : settledAt - t0,
    evidence: receipt?.evidence ?? null,
    liveMembers: procs(name).length,
    calls: [...calls],
  };
  // The leftover member ends on its own (not through the registry).
  const killedAt = Date.now();
  for (const pid of procs(name)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  await Promise.race([registered, sleep(15_000)]);
  const after = {
    settled: settledAt !== null,
    settledMsAfterMemberEnd: settledAt === null ? null : settledAt - killedAt,
    holdReleased: !reg.hasHolds(`s-${label}`),
    evidence: receipt?.evidence ?? null,
    unitDirLeft: fs.existsSync(path.join(ROOT, name)),
    calls: [...calls],
  };
  if (fs.existsSync(path.join(ROOT, name))) {
    try { fs.writeFileSync(path.join(ROOT, name, 'cgroup.kill'), '1'); } catch {}
    await sleep(300);
    try { fs.rmdirSync(path.join(ROOT, name)); } catch {}
  }
  return { during, after };
}

const result = {
  arm: process.env.ARM,
  daemonInheritsPipes: await scenario('daemon', '(sleep 3151 &); sleep 0.5; echo started; exit 0', 8000),
  setsidClosedPipes: await scenario('setsid', "setsid sh -c 'sleep 3152' </dev/null >/dev/null 2>&1 & sleep 0.5; exit 0", 8000),
  control: await scenario('control', 'sleep 0.5; echo done; exit 0', 3000),
};
console.log(`[RESULT] ${JSON.stringify(result)}`);
process.exit(0);
