// host: merge unit verdicts (unit2-summary.json) and E2E verdicts (batch-new-b.console) into out/mut/summary.json
import { readFileSync, writeFileSync } from 'node:fs';
const RIG = '/rig';
const u = JSON.parse(readFileSync(`${RIG}/out/mut/unit2-summary.json`, 'utf8'));
const b = readFileSync(`${RIG}/out/batch-new-b.console`, 'utf8').split('\n');
const e2e = (id, mode) => {
  const line = b.find((l) => l.startsWith(`[${id}] ${mode} exit=`));
  if (!line) return 'n/a';
  if (line.includes('exit=0')) return id === 'T00' ? '== passes' : '!! not caught (mode passes)';
  const text = (line.match(/text="([A-Z_]+)"/) ?? [])[1];
  if (text) return text.startsWith('CONTINUATION_PARTIAL') ? "++ caught: the dead owner's partial text is still public" : '++ caught: the answer is public twice';
  if (line.includes('partial text did not become ready')) return '++ caught: the partial text never becomes public';
  if (line.includes('terminal event did not become ready')) return '++ caught: no terminal event';
  return '++ caught';
};
const unit = (id) => {
  const r = u.find((x) => x.id === id);
  if (!r) return 'n/a';
  if (r.killedBy.length) return `++ caught by ${r.killedBy.length} test${r.killedBy.length > 1 ? 's' : ''}`;
  const n = r.failedOnlyInFullRun.length;
  return `${id === 'T00' ? '== ' : '!! not caught: '}all ${r.total} pass${n ? ` (${n} load flake${n > 1 ? 's' : ''}, passing alone)` : ''}`;
};
const rows = [
  ['T00', 'no mutation (control)'],
  ['T01', 'the load ignores the takeover request'],
  ['T02', 'a message whose text already streamed is projected a second time'],
  ['T03', 'live tool Turns publish no durable text deltas'],
  ['T04', 'recovery drives the parked execution without acquiring the Runtime Session'],
  ['T07', 'the Runtime Session acquired by recovery is never released'],
].map(([id, what]) => ({ id, what, unit: unit(id), inflight: e2e(id, 'inflight'), continuation: e2e(id, 'continuation') }));
rows.push({
  id: 'J02',
  what: "the coordinator does not retract the dead owner's public output (Java)",
  unit: '++ caught by 2 tests (HarnessCoordinatorTest)',
  inflight: e2e('J02', 'inflight'),
  continuation: e2e('J02', 'continuation'),
});
writeFileSync(`${RIG}/out/mut/summary.json`, JSON.stringify(rows, null, 1));
for (const r of rows) console.log([r.id, r.unit, r.inflight, r.continuation].join(' | '));
