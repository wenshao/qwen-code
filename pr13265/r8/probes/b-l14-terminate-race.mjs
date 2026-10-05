// PR #13265 round 3 — L14: terminate() with one TERM-ignoring member, N times.
// Counts how often the supervisor answers null ("not proven") and leaves the
// unit directory behind although cgroup.kill emptied it.
// L15: natural exit while a background child keeps the pipes open, through
// the registry with its default 5 s EOF grace.
import fs from 'node:fs';
import path from 'node:path';

const DIST = process.env.DIST;
const ROOT = process.env.CGROUP_ROOT;
const N = Number(process.env.N ?? 20);
const { ManagedChildRunSupervisor } = await import('@qwen-code/qwen-code-core/managed-runtime/managed-child-run-supervisor.js');
const { ManagedBackgroundShellRegistry } = await import('@armcli/serve/managed-background-shell-registry.js');
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = (name) => { try { return fs.readFileSync(path.join(ROOT, name, 'cgroup.events'), 'utf8').replace(/\n/g, ' ').trim(); } catch { return 'NO UNIT'; } };
const start = (name, cmd) => sup.start({ unitName: name, executable: '/bin/sh', args: ['-c', cmd], env: { PATH: process.env.PATH }, cwd: '/tmp', onOutput: () => {} });

const t = { nullEvidence: 0, evidence: 0, unitLeft: 0, emptyRightAfter: 0 };
for (let i = 0; i < N; i++) {
  const name = `qwen-bg-l14-${i}`;
  const p = await start(name, `(trap '' TERM; sleep 3141) & sleep 3142`);
  await sleep(300);
  const ev = await p.terminate(500);
  if (ev === null) t.nullEvidence++; else t.evidence++;
  if (fs.existsSync(path.join(ROOT, name))) {
    t.unitLeft++;
    if (/populated 0/.test(events(name))) t.emptyRightAfter++;
    try { fs.rmdirSync(path.join(ROOT, name)); } catch {}
  }
}
console.log(`[L14 terminate x${N}] ${JSON.stringify(t)}`);

const name = 'qwen-bg-l15';
const calls = [];
const sink = { write: () => {}, setStarted: () => {}, setProcessResult: () => {}, finish: async (s, eof) => calls.push(`finish(${s},${eof})`), finalize: async (status) => { calls.push(`finalize(${status})`); return { executionStatus: status }; } };
const reg = new ManagedBackgroundShellRegistry();
const p = await start(name, `(sleep 3151 &); sleep 0.5; echo started; exit 0`);
const t0 = Date.now();
const receipt = await reg.register({ unitName: name, sessionId: 's15', process: p, sink, publisher: { finish: async () => calls.push('publisher.finish') }, identity: {} });
const ms = Date.now() - t0;
const alive = fs.readFileSync(path.join(ROOT, name, 'cgroup.procs'), 'utf8').trim().split('\n').filter(Boolean).length;
console.log(`[L15 inherited pipes] ${JSON.stringify({ msUntilHoldReleased: ms, holdAfter: reg.hasHolds('s15'), evidence: receipt.evidence, unitEvents: events(name), liveMembers: alive, calls })}`);
fs.writeFileSync(path.join(ROOT, name, 'cgroup.kill'), '1');
await sleep(300);
try { fs.rmdirSync(path.join(ROOT, name)); } catch {}
console.log(`[RESULT] ${JSON.stringify({ L14: t, L15: { msUntilHoldReleased: ms, holdReleased: !reg.hasHolds('s15'), liveMembers: alive } })}`);
process.exit(0);
