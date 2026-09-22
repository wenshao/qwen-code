// Round-2 figures at 3aab049: (1) round-1 follow-ups + mutation delta, (2) rerun summary.
import fs from 'node:fs';
const B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m', G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m';
const W = '/root/verify/pr12353-work';
const R = `${W}/runs`;
const out = [];
const line = (s = '') => out.push(s);
const flush = (f) => { fs.writeFileSync(f, out.join('\n') + '\n'); out.length = 0; };
const j = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ---------- figure 1 ----------
line(`${D}# range-diff 46f6aeb..adc5c44 vs 74b5eb9..f1d9686:  1ca47a8 = c57c85d · adc5c44 = f1d9686  (rebase only; new commit 3aab049)${X}`);
line();
line(`${B}${'Round-1 follow-up'.padEnd(56)}${'at 3aab049'.padEnd(24)}evidence${X}`);
const rows = [
  ['Pin NODE_OPTIONS parity with Node as the oracle', `${G}✓ added verbatim${X}`, 'child-heap-args.test.ts 7 → 10 tests; kills M01 + M06 (below)'],
  ['--memory-budget-mb help said "does not size children"', `${G}✓ fixed${X}`, 'serve --help: "In `admit` and `enforce` modes it determines…"'],
  ['daemon-status.ts:475 "enforced … stays false"', `${G}✓ fixed${X}`, 'comment now defers to limits.memory.enforced'],
  ['Name the in-product heap telemetry in rollout docs', `${G}✓ en + zh design §6${X}`, 'procedure replayed on the real daemon (figure 2, row E)'],
  ['Percentage conflict detected after the listener', `${Y}– kept (author)${X}`, 'still exit 1 ~1 s after "listening"; fail-closed; non-blocking'],
];
for (const [a, b, c] of rows) line(`  ${a.padEnd(54)}${b}${' '.repeat(Math.max(1, 24 - b.replace(/\x1b\[[0-9;]*m/g, '').length))}${D}${c}${X}`);
line();
const m1 = Object.fromEntries(fs.readdirSync(`${W}/mutants/results`).filter((f) => /^M\d\d\.json$/.test(f)).map((f) => [f.slice(0, 3), j(`${W}/mutants/results/${f}`)]));
const m2 = Object.fromEntries(fs.readdirSync(`${W}/mutants/results-r2`).filter((f) => /^M\d\d\.json$/.test(f)).map((f) => [f.slice(0, 3), j(`${W}/mutants/results-r2/${f}`)]));
const ids = Object.keys(m2).filter((k) => k !== 'M00').sort();
const k1 = ids.filter((k) => m1[k].killed).length, k2 = ids.filter((k) => m2[k].killed).length;
line(`${D}# 28 targeted mutants on the PR's production lines vs the PR's own 12 test files (control M00: ${m1.M00.killed ? 'FAIL' : '0 failures'} → ${m2.M00.killed ? 'FAIL' : '0 failures'})${X}`);
line(`  ${B}killed: adc5c44 ${k1}/${ids.length}  →  3aab049 ${k2}/${ids.length}${X}`);
for (const k of ids.filter((k) => m1[k].killed !== m2[k].killed || !m2[k].killed)) {
  const s = (m) => (m.killed ? `${G}killed${X}` : `${RED}survives${X}`);
  const by = m2[k].killed ? `${D}by: ${[...new Set([...(m2[k].acp.failed || []), ...(m2[k].cli.failed || [])].map((f) => f.split(' :: ')[1].replace(/: --report-filename.*/, '')))].join('; ')}${X}` : `${D}win32-only branch; not reachable on Linux${X}`;
  line(`  ${k} ${m2[k].desc.padEnd(58)} adc5c44 ${s(m1[k])}  →  3aab049 ${s(m2[k])}   ${by}`);
}
flush(`${W}/figs/fig-r2-followups.ansi`);

// ---------- figure 2 ----------
line(`${D}# real daemon, bundles built from scratch: base 74b5eb9 (= current main) vs head 3aab049 · Linux x64 · Node v22.22.2${X}`);
line(`${D}# node --max-old-space-size=4096 --trace-warnings --require probe.cjs dist/cli.js serve --memory-budget-mb 1024 … (+ NODE_OPTIONS=--max-old-space-size=3072)${X}`);
line();
line(`${B}A. observe / admit / off — child argv heap flags and V8 limit, base vs head${X}`);
for (const mode of ['observe', 'admit', 'off']) {
  const b = j(`${R}/legacy-r2base-${mode}/report.json`), h = j(`${R}/legacy-r2head-${mode}/report.json`);
  const same = JSON.stringify(b.child.heapFlags) === JSON.stringify(h.child.heapFlags) && b.child.v8HeapSizeLimitMb === h.child.v8HeapSizeLimitMb && b.enforced === h.enforced && b.secondaryWhilePrimaryRetained.status === h.secondaryWhilePrimaryRetained.status;
  line(`  ${mode.padEnd(8)} base: ${b.child.heapFlags.join(' ')} → ${b.child.v8HeapSizeLimitMb} MiB, enforced=${b.enforced}   head: ${same ? G + 'identical' : RED + 'DIFFERS'}${X}`);
}
line();
line(`${B}B. enforce lifecycle (primary / startup-secondary / dynamic, 1 slot × 768 MiB)${X}`);
for (const r of [1, 2]) {
  const rep = j(`${R}/lifecycle-r2head-enforce-r${r}/report.json`);
  const v = rep.views;
  const same = ['primary', 'secondary', 'dynamic'].every((k) => v[k].cmdlineHeapFlags.join(' ') === '--max-old-space-size=768 --expose-gc' && v[k].v8HeapSizeLimitMb === 816);
  line(`  run ${r}: ${rep.failed === 0 ? G : RED}${rep.passed} passed, ${rep.failed} failed${X}   primary / secondary / dynamic child: ${same ? G : RED}--max-old-space-size=768 --expose-gc → 816 MiB each${X}`);
}
line();
const race = j(`${R}/race-r2head.json`);
line(`${B}C. concurrent admission, 2 slots × ${race[0].ceiling} MiB, 4 simultaneous new-workspace requests${X}`);
line(`  ${race.map((r) => `round ${r.round}: ${r.ok}×200 ${r.refused}×503 max-live ${r.maxChildrenSeen} kill-9→${r.afterKill.status}`).join('   ')}`);
line();
const boot = j(`${R}/boot-matrix-r2head.json`);
line(`${B}D. boot validation${X}  ${D}(exit 1 = the intended fail-closed refusal: percentage conflict or zero-slot partition)${X}`);
const cell = (r) => `${r.id.replace('-enforce', '/enforce').replace('-admit', '/admit').replace('-observe', '/observe').padEnd(28)} ${r.runtimeUp ? G + 'runs  ' : RED + 'exit ' + r.exit.code}${X}`;
for (let i = 0; i < boot.length; i += 3) line('  ' + boot.slice(i, i + 3).map(cell).join('    '));
line();
line(`${B}E. calibration procedure from the updated design §6 (attach watcher → GET /daemon/status?detail=full)${X}`);
const hs = fs.readFileSync(`${R}/heap-sample-r2head.stdout`, 'utf8');
const h = JSON.parse(hs.slice(hs.indexOf('{')));
const hp = h.after.children.heap;
line(`  before watcher: sampled=${h.before.children.sampled} heap=${JSON.stringify(h.before.children.heap)}   after 12 s: sampled=${h.after.children.sampled} reported=${hp.reported}`);
line(`  peakLiveSetBytes=${hp.peakLiveSetBytes} (${(hp.peakLiveSetBytes / 1048576).toFixed(1)} MiB)  peakOldGenerationBytes=${hp.peakOldGenerationBytes}  majorGcCount=${hp.majorGcCount}  vs perChildCeilingMb=${G}${h.limit.perChildCeilingMb}${X}`);
line();
line(`${B}F. DEV=true NODE_OPTIONS round trip (two preload files: dir\\sub/p.cjs vs dirsub/p.cjs)${X}`);
for (const k of ['triage', 'escaped', 'unquoted']) {
  const r = j(`${R}/dev-r2head-enforce-${k}/report.json`);
  const d = r.loads.find((l) => l.role === 'daemon'), c = r.loads.find((l) => l.role === 'acp-child');
  line(`  ${k.padEnd(9)} daemon ${d.loaded.padEnd(17)} child ${c.loaded === d.loaded ? G : RED}${c.loaded.padEnd(17)}${X} child heap ${c.heapMb} MiB`);
}
flush(`${W}/figs/fig-r2-rerun.ansi`);
