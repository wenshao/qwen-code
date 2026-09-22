// Figure 4 transcript: concurrent admission, boot-time validation, mutation matrix.
import fs from 'node:fs';
const B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m', G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m';
const line = (s = '') => process.stdout.write(s + '\n');
const R = '/root/verify/pr12353-work/runs';

const race = JSON.parse(fs.readFileSync(`${R}/race-head.json`, 'utf8'));
line(`${D}# A. Concurrent admission: --memory-budget-mb 1400 → ${race[0].slots} slots × ${race[0].ceiling} MiB; 4 simultaneous POST /session for 4 fresh workspaces${X}`);
for (const r of race) {
  line(`  round ${r.round}: ${r.burst.map((b) => (b.includes(':200') ? G : Y) + b.replace('/acp_child_capacity_exhausted', '/capacity') + X).join('  ')}  max live ${B}${r.maxChildrenSeen}${X}  kill -9 one → ${r.afterKill.workspace}:${r.afterKill.status === 200 ? G : RED}${r.afterKill.status}${X}  leftover ${r.leftover.length}`);
}
line(`  ${D}every admitted child: ${[...new Set(race.flatMap((r) => r.childFlags))].join(' | ')} · refusals reported per round: ${[...new Set(race.map((r) => r.refusalsReported))].join(',')}${X}`);
line();
const boot = JSON.parse(fs.readFileSync(`${R}/boot-matrix-head.json`, 'utf8'));
const label = {
  'pct-execargv-enforce': 'node --max-old-space-size-percentage=50 … enforce',
  'pct-execargv-admit': 'node --max-old-space-size-percentage=50 … admit',
  'pct-underscore-enforce': 'node --max_old_space_size_percentage=50 … enforce',
  'pct-dev-nodeoptions-enforce': 'DEV=true NODE_OPTIONS=--max-old-space-size-percentage=50 … enforce',
  'pct-prod-nodeoptions-enforce': 'NODE_OPTIONS=--max-old-space-size-percentage=50 … enforce (prod scrub)',
  'underscore-fixed-enforce': 'node --max_old_space_size=4096 --max-old-space-size=2048 … enforce',
  'zero-slot-cgroup-enforce': 'systemd-run -p MemoryMax=900M … enforce',
  'zero-slot-cgroup-admit': 'systemd-run -p MemoryMax=900M … admit',
  'zero-slot-cgroup-observe': 'systemd-run -p MemoryMax=900M … observe',
};
line(`${D}# B. Boot-time validation (real daemon)${X}`);
for (const r of boot) {
  const failLine = r.stderrTail.find((l) => /cannot be combined|requires a memory budget/.test(l)) ?? '';
  const outcome = r.runtimeUp
    ? `${G}runs${X}  child: ${r.childHeapFlags?.join(' ')}${r.status?.availableMemorySource === 'constrained' ? `  ${D}(${r.status.availableMemoryMb} MiB constrained, ${r.status.childHeap.maxConcurrentChildren} slots)${X}` : ''}`
    : `${RED}exit ${r.exit.code}${X}${r.listened ? D + ' (after listener)' + X : D + ' (before listen)' + X}  ${failLine.replace(/^qwen serve: (runtime startup failed after listener was ready: )?/, '').replace('ACP heap enforcement cannot be combined with', 'enforcement cannot be combined with').replace('ACP admission requires a memory budget that models', 'requires a budget that models')}`;
  line(`  ${label[r.id].padEnd(70)} ${outcome}`);
}
line();
const M = '/root/verify/pr12353-work/mutants/results';
const muts = fs.readdirSync(M).filter((f) => /^M\d\d\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(`${M}/${f}`, 'utf8')));
const real = muts.filter((m) => m.id !== 'M00');
const killed = real.filter((m) => m.killed).length;
line(`${D}# C. Targeted mutants on the PR's production lines vs the PR's own 12 test files (137 acp-bridge + 2066 cli tests)${X}`);
line(`  control M00: ${muts[0].killed ? RED + 'FAILED' : G + '0 failures'}${X}    killed ${B}${killed}/${real.length}${X}    ${D}(✓ = some PR test fails, ✗ = mutant survives the whole suite)${X}`);
const cols = 2;
const cells = real.map((m) => `${m.killed ? G + '✓' : RED + '✗'} ${m.id}${X} ${m.desc.slice(0, 64).padEnd(64)}`);
for (let i = 0; i < cells.length; i += cols) line('  ' + cells.slice(i, i + cols).join('  '));
