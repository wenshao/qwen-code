// Open question 5 of #12863: a run whose execution settled while blocked may
// still step back to running/waiting under the contract. PR-head dist.
import * as path from 'node:path';
const dist = path.resolve(process.argv[2]);
const r = await import(path.join(dist, 'src/managed-runtime/managed-extension-record.js'));
const fx = (await import(path.resolve(process.argv[3]), { with: { type: 'json' } })).default;
const pair = fx.monitorRunSuccessorCases.find((c) => c.id === 'lost-watch-proven-ended');
const blocked = pair.next;
console.log('fixture lost-watch-proven-ended next:', blocked.run.state, blocked.run.reason, blocked.run.execution);
for (const state of ['running', 'waiting']) {
  const back = structuredClone(blocked);
  back.run.state = state; back.run.reason = null;
  console.log(`monitor  recovery_blocked/settled -> ${state}/settled: isMonitorRunSuccessor = ${r.isMonitorRunSuccessor(blocked, back)}`);
  console.log(`run      recovery_blocked/settled -> ${state}/settled: isExtensionRunSuccessor = ${r.isExtensionRunSuccessor(blocked.run, back.run)}`);
}
const rebuild = fx.monitorRunSuccessorCases.find((c) => c.id === 'rebuilds-after-a-proven-end');
console.log(`rebuilds-after-a-proven-end: isMonitorRunSuccessor = ${r.isMonitorRunSuccessor(rebuild.previous, rebuild.next)} (fixture valid=${rebuild.valid})`);
