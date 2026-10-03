// VERIFICATION RIG ONLY (PR #13179): per-delta cost of the streamed-event merge, main vs PR, under node 24 type stripping.
// The hook calls mergeManagedEvents(current.events, [event]) once per streamed event; the page then re-projects
// every event with managedEventsToMessages (useMemo on detail.events) — identical in both trees, measured for scale.
import { performance } from 'node:perf_hooks';
const base = await import('./msgs-base.ts');
const merge = await import('./msgs-merge.ts');
const ev = (id, turn) => ({ id, at: id, type: 'assistant_delta', sessionId: 's1', turnId: `t${turn}`, data: { delta: `[T-${id}] ` } });
function run(mod, total, sample) {
  let events = [];
  const per = [];
  let mergeMs = 0, projMs = 0;
  for (let id = 1; id <= total; id++) {
    const e = ev(id, Math.floor(id / 500));
    const t0 = performance.now();
    events = mod.mergeManagedEvents(events, [e]);
    const t1 = performance.now();
    mergeMs += t1 - t0;
    if (id % sample === 0) {
      const p0 = performance.now();
      mod.managedEventsToMessages(events, 'truncated');
      const p1 = performance.now();
      projMs += (p1 - p0) * sample; // extrapolated: the page re-projects on every event
      per.push({ id, merge: t1 - t0, proj: p1 - p0 });
    }
  }
  return { mergeMs, projMs, per, ids: events.map((x) => x.id) };
}
const out = {};
for (const total of [1000, 4000, 10000]) {
  for (const [name, mod] of [['base', base], ['merge', merge], ['base', base], ['merge', merge]]) run(mod, Math.min(total, 2000), 100); // warm-up
  const rows = {};
  for (const rep of [0, 1, 2]) for (const [name, mod] of rep % 2 ? [['merge', merge], ['base', base]] : [['base', base], ['merge', merge]]) {
    const r = run(mod, total, 50);
    (rows[name] ??= []).push(r);
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const same = JSON.stringify(rows.base[0].ids) === JSON.stringify(rows.merge[0].ids);
  out[total] = {
    sameOutput: same,
    mergeMsBase: med(rows.base.map((r) => r.mergeMs)),
    mergeMsPR: med(rows.merge.map((r) => r.mergeMs)),
    projMsExtrapolated: med(rows.base.map((r) => r.projMs)),
    lastDeltaMergeUsBase: med(rows.base.map((r) => r.per.at(-1).merge * 1000)),
    lastDeltaMergeUsPR: med(rows.merge.map((r) => r.per.at(-1).merge * 1000)),
    lastDeltaProjUs: med(rows.base.map((r) => r.per.at(-1).proj * 1000)),
  };
  console.log(`RESULT n=${total} ${JSON.stringify(out[total])}`);
}
