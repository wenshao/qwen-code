// Appends the round-2 re-runs (fixed tap / fixed timing), the F1c mutant arm
// and the upgrade path to assets/results-r2.tsv, and marks superseded rows.
import fs from 'node:fs';
const R = '/Users/wenshao/pr13219-rig/runs';
const OUT = '/Users/wenshao/pr13219-rig/assets/results-r2.tsv';
const load = (n) => JSON.parse(fs.readFileSync(`${R}/${n}/result.json`, 'utf8'));
let tsv = fs.readFileSync(OUT, 'utf8').split('\n').map((l) => (/^r2-(head|base)-(close-harness-down|ambiguous-admitted)\t/.test(l) ? l.replace(/\t([^\t]*)$/, '\tSUPERSEDED by r2b- ($1)') : l)).join('\n');
const rows = [];
for (const a of ['head', 'base']) {
  let r = load(`r2b-${a}-close-harness-down`);
  const ar = r.afterRecovery;
  rows.push([`r2b-${a}-close-harness-down`, r.commit, `end of 60s: ${r.samples.at(-1).op} sess=${r.samples.at(-1).sess}; after Harness restart: replay=${ar.replay.status} ${ar.replay.body.status}; delete-while-closing=${ar.deleteWhileClosing.status} ${ar.deleteWhileClosing.body?.error?.code ?? ''}; fresh close=${ar.fresh.status} ${ar.fresh.body?.status ?? ar.fresh.body?.error?.code}; then ${r.samplesAfter.at(-1).op.join(' + ')} sess=${r.samplesAfter.at(-1).sess} at +${r.samplesAfter.at(-1).t}ms; delete later=${r.deleteAfter.status}; final sess=${r.samplesDelete.at(-1).sess}`]);
  r = load(`r2b-${a}-ambiguous-admitted`);
  rows.push([`r2b-${a}-ambiguous-admitted`, r.commit, `turn1=${r.turn1.status ?? 'not terminal'}/${r.turn1.code ?? ''}; orphan finished at ${r.orphanFinishedAt}ms (completed=${r.orphanCompleted}); A=${r.followupA.accepted} ${r.followupA.row ? `${r.followupA.row.status}/${r.followupA.row.code}` : ''}; B (after orphan)=${r.followupB.accepted} ${r.followupB.row ? `${r.followupB.row.status}/${r.followupB.row.code}` : ''}`]);
}
for (const n of ['r2b-head-turn-poison-harness-restart', 'r2b-base-turn-poison-harness-restart', 'r2b-f1c-turn-poison-harness-restart']) {
  const r = load(n);
  const c = {};
  for (const x of r.requestsAfterRestart) c[x] = (c[x] ?? 0) + 1;
  rows.push([n, n.includes('f1c') ? `${r.commit}+F1c-mutant-jar` : r.commit, `turn1=${r.turn1 ? `${r.turn1.status}/${r.turn1.code}` : 'not terminal'}; A=${r.followupA.accepted} ${r.followupA.row ? `${r.followupA.row.status}/${r.followupA.row.code} retries=${r.followupA.row.retries}` : ''}; requests after restart=${JSON.stringify(c)}`]);
}
{
  const r = load('r2-upgrade-inflight');
  rows.push(['r2-upgrade-inflight', 'base 6936c77 -> head b372721', `before (V${r.beforeUpgrade.flyway}): ${r.beforeUpgrade.ops.join(' ; ')} ; turnB ${r.beforeUpgrade.turnB.join(',')} || after V68: ${r.afterMigration.ops.join(' ; ')} ; turnB ${r.afterMigration.turnB.join(',')} || final +${(r.final.t / 1000).toFixed(1)}s: ${r.final.ops.join(' ; ')} ; turnB ${r.final.turnB.join(',')}`]);
}
tsv = tsv.trimEnd() + '\n' + rows.map((x) => x.join('\t')).join('\n') + '\n';
fs.writeFileSync(OUT, tsv);
console.log(rows.map((x) => x.join('\t')).join('\n'));
