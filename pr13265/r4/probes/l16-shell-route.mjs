// PR #13265 round 4 — L16: what the worker's shell maintenance route
// (ManagedShellRuntime.control) answers on real cgroup v2. The Broker settles
// a background process row only when shell-status answers `exited`
// (RuntimeBrokerService.observeBackgroundProcess).
import fs from 'node:fs';
import path from 'node:path';

const DIST = process.env.DIST;
const ROOT = process.env.CGROUP_ROOT;
const { ManagedChildRunSupervisor } = await import(`${DIST}/core/managed-runtime/managed-child-run-supervisor.js`);
const { ManagedBackgroundShellRegistry } = await import(`${DIST}/cli/serve/managed-background-shell-registry.js`);
const { ManagedShellRuntime } = await import(`${DIST}/cli/serve/managed-shell-runtime.js`);
const { shellUnitNameOf } = await import(`${DIST}/core/managed-runtime/managed-shell-protocol.js`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSION = 'runtime-session-l16';
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
const reg = new ManagedBackgroundShellRegistry();
const route = new ManagedShellRuntime(reg);
const sink = () => ({ write: () => {}, setStarted: () => {}, setProcessResult: () => {}, finish: async () => {}, finalize: async (s) => ({ executionStatus: s }) });
const op = (kind, target) => ({ kind, operationId: `op-${kind}-${target}`, sessionKey: { tenantId: 't', sessionId: 's' }, targetOperationId: target });
const events = (unit) => { try { return fs.readFileSync(path.join(ROOT, unit, 'cgroup.events'), 'utf8').replace(/\n/g, ' ').trim(); } catch { return 'NO UNIT'; } };
const out = {};

async function launch(target, command) {
  const unitName = shellUnitNameOf(target);
  const p = await sup.start({ unitName, executable: '/bin/sh', args: ['-c', command], env: { PATH: process.env.PATH }, cwd: '/tmp', onOutput: () => {} });
  const completion = reg.register({ unitName, sessionId: SESSION, process: p, sink: sink(), publisher: { finish: async () => {} }, identity: {} });
  return { unitName, p, completion };
}
const ask = async (kind, target) => {
  try { return await route.control(SESSION, op(kind, target)); } catch (e) { return { error: `${e.name}: ${e.message}` }; }
};

// a. a running Shell
{
  const t = 'call-l16-running';
  const { unitName } = await launch(t, 'sleep 3161');
  await sleep(300);
  out.a_statusRunning = await ask('shell-status', t);
  out.a_terminate = await ask('shell-terminate', t);
  out.a_statusAfter = await ask('shell-status', t);
  out.a_unit = events(unitName);
}
// b. a Shell that exits on its own
{
  const t = 'call-l16-natural';
  const { unitName, completion } = await launch(t, 'sleep 0.5; exit 3');
  out.b_statusWhileRunning = await ask('shell-status', t);
  const receipt = await completion;
  out.b_registryReceipt = receipt.evidence;
  out.b_statusAfterExit = await ask('shell-status', t);
  out.b_terminateAfterExit = await ask('shell-terminate', t);
  out.b_unit = events(unitName);
  try { fs.rmdirSync(path.join(ROOT, unitName)); } catch {}
}
// c. terminate with one TERM-ignoring member, ×10
{
  const tally = { exited: 0, unknown: 0, other: 0, statusAfter: {} };
  for (let i = 0; i < 10; i++) {
    const t = `call-l16-noterm-${i}`;
    const { unitName } = await launch(t, `(trap '' TERM; sleep 3162) & sleep 3163`);
    await sleep(300);
    const v = await ask('shell-terminate', t);
    tally[v.state] = (tally[v.state] ?? 0) + 1;
    await sleep(1500);
    const s = await ask('shell-status', t);
    tally.statusAfter[s.state] = (tally.statusAfter[s.state] ?? 0) + 1;
    if (fs.existsSync(path.join(ROOT, unitName))) { try { fs.writeFileSync(path.join(ROOT, unitName, 'cgroup.kill'), '1'); } catch {} await sleep(200); try { fs.rmdirSync(path.join(ROOT, unitName)); } catch {} }
  }
  out.c_terminateNoTerm = tally;
}
console.log(`[RESULT] ${JSON.stringify(out)}`);
for (const d of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-bg-call-l16'))) {
  try { fs.writeFileSync(path.join(ROOT, d, 'cgroup.kill'), '1'); } catch {}
}
await sleep(300);
for (const d of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-bg-call-l16'))) { try { fs.rmdirSync(path.join(ROOT, d)); } catch {} }
process.exit(0);
