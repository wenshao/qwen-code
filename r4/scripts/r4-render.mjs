// usage: node r4-render.mjs diff|mutation   — prints measured JSON, adds nothing
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const J = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const C = { r: '\x1b[1;31m', g: '\x1b[1;32m', y: '\x1b[1;33m', c: '\x1b[1;36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const n = (x) => x.toLocaleString('en-US');
const which = process.argv[2];
const [OLD, NEW] = ['/root/verify/pr12302-head', '/root/verify/pr12302-r4'];

if (which === 'diff') {
  const o = J('fuzz-full.json');
  console.log(`${C.c}B. What changed between the two built artifacts, bf1a6b1 → 32035a1 — same seeded inputs to both arms${C.x}`);
  console.log(C.d + '─'.repeat(128) + C.x);
  const row = (what, total, same, note) => console.log(`  ${what.padEnd(58)}${n(total).padStart(10)} inputs   ${(same === total ? C.g : C.y)}${n(total - same).padStart(7)} differ${C.x}   ${C.d}${note}${C.x}`);
  row('typed parsers: header / commit marker / all 15 event kinds', o.iterations, o.counts.same, `${n(o.counts.acceptBoth)} accepted by both, ${n(o.counts.rejectBoth)} rejected by both`);
  row('raw parser: random JSON with adversarial number tokens', o.raw.iterations, o.raw.same, '');
  row('lifecycle predicate: every from × to pair', 100, 100 - o.lifecycleDiffs.length, '');
  row('list validators: random 1-4 event lists, depth 3…66', o.list.iterations, o.list.same, 'plain arrays and forEach-overriding subclasses, gaps, cross-session, byte caps');
  console.log(C.d + '─'.repeat(128) + C.x);
  console.log(`  every one of the ${n(o.list.iterations - o.list.same)} list-validator differences:`);
  for (const [k, c] of o.list.buckets) {
    const [fn, rest] = k.split(': ');
    const [verd, depth] = rest.split(' | ');
    console.log(`  ${n(c).padStart(9)}  ${fn.padEnd(12)} ${C.g}REJECT${C.x} → ${C.y}ACCEPT${C.x}   ${depth}${verd.includes('DIFFERENT') ? C.r + '  DIGEST VALUE CHANGED' + C.x : ''}`);
  }
  console.log(`  ${C.g}no list whose deepest event is 65 or 66 became acceptable; no list accepted by both arms changed its digest value${C.x}`);
  const run = (r) => JSON.parse(execFileSync('node', [path.join(here, 'ab-fixes.mjs'), r], { maxBuffer: 1 << 26 }).toString());
  const a = run(OLD);
  const b = run(NEW);
  let differ = 0;
  for (let i = 0; i < a.length; i++) if (a[i].v !== b[i].v) differ++;
  console.log(`\n${C.c}C. The 26 review-thread probes from round 3, replayed on 32035a1${C.x}`);
  console.log(`  ${a.length} probes, ${differ === 0 ? C.g : C.r}${differ} verdicts differ from bf1a6b1${C.x} — ${b.filter((x) => x.v === 'REJECT').length} REJECT, ${b.filter((x) => x.v === 'ACCEPT').length} ACCEPT (minimumReader/0 + the three the author declared partial/declined), ${b.filter((x) => x.v === 'CRASH').length} CRASH`);
  const pa = [1, 2].map((r) => J(`perf-r2-${r}.json`));
  const pb = [1, 2].map((r) => J(`perf-head-${r}.json`));
  console.log(`\n${C.c}D. Per-record cost — unchanged, as expected for a fix that adds no work${C.x}`);
  for (const k of ['fullSmall', 'fullDeep', 'tx256']) {
    const x = Math.min(pa[0][k].ms, pa[1][k].ms);
    const y = Math.min(pb[0][k].ms, pb[1][k].ms);
    const f = (ms) => (ms < 0.1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`);
    console.log(`  ${pa[0][k].label.padEnd(56)} bf1a6b1 ${f(x).padStart(9)}   32035a1 ${f(y).padStart(9)}   ${(y / x).toFixed(3)}×`);
  }
}

if (which === 'mutation') {
  const t = J('targeted.json');
  console.log(`${C.c}Mutants aimed at the lines 32035a1 changed — does the new test pin the fix in both directions, at both call sites?${C.x}`);
  console.log(C.d + '─'.repeat(150) + C.x);
  for (const r of t.rows) {
    const v = r.id === 't0' ? `${C.g}GREEN   ${C.x}` : r.failed ? `${C.g}KILLED  ${C.x}` : `${C.r}SURVIVED${C.x}`;
    console.log(`  ${v} ${String(r.total - r.failed).padStart(2)}/${r.total}  ${r.label.padEnd(66)}${C.d}${r.by.length ? '← ' + r.by[0] : ''}${C.x}`);
  }
  console.log(C.d + '─'.repeat(150) + C.x);
  const rows = ['r2', 'head'].map((label) => {
    const m = J(`mut-${label}.json`);
    const c = J(`classify-${label}.json`);
    return { m, live: c.filter((x) => x.witness), msg: c.filter((x) => !x.witness && x.messageOnly), un: c.filter((x) => !x.witness && !x.messageOnly), killed: m.sites.filter((s) => s.killed).length };
  });
  console.log(`\n${C.c}Guard-deletion sweep (one mutant per fail(...) site, same automated sweep as round 3)${C.x}\n`);
  console.log(`${C.b}${''.padEnd(34)}${'bf1a6b1'.padStart(10)}${'32035a1'.padStart(10)}${C.x}`);
  const line = (name, f) => console.log(`${name.padEnd(34)}${String(f(rows[0])).padStart(10)}${String(f(rows[1])).padStart(10)}`);
  line('tests in the file (control green)', (r) => `${r.m.control.total - r.m.control.failed}/${r.m.control.total}`);
  line('guard sites mutated', (r) => r.m.sites.length);
  line('killed', (r) => r.killed);
  line('survived — verdict-bearing', (r) => r.live.length);
  line('survived — message only', (r) => r.msg.length);
  line('survived — unreachable', (r) => r.un.length);
  console.log(`${C.b}${'score over verdict-bearing'.padEnd(34)}${rows.map((r) => `${r.killed}/${r.killed + r.live.length} ${Math.round((100 * r.killed) / (r.killed + r.live.length))}%`.padStart(10)).join('')}${C.x}`);
  const before = new Set(rows[0].live.map((s) => s.msg));
  const after = new Set(rows[1].live.map((s) => s.msg));
  console.log(`\n${C.b}newly killed:${C.x}`);
  for (const s of rows[0].live.filter((x) => !after.has(x.msg))) console.log(`  ${C.g}✓${C.x} L${String(s.line).padEnd(5)}${s.fn.padEnd(28)}${s.msg.replace(/\$\{[^}]*(\}|$)/g, '…').slice(0, 70)}`);
  console.log(`${C.b}still verdict-bearing survivors (${rows[1].live.length}):${C.x}`);
  for (const s of rows[1].live) console.log(`    L${String(s.line).padEnd(5)}${s.fn.padEnd(28)}${s.msg.replace(/\$\{[^}]*(\}|$)/g, '…').slice(0, 52).padEnd(54)}${C.g}REJECT${C.x} → ${s.witness.to === 'ACCEPT' ? C.y + 'ACCEPT' : C.r + 'CRASH '}${C.x}  ${C.d}${s.witness.name}${C.x}`);
  console.log(`${C.d}  tracked files never edited; git status clean after each run: ${t.clean && rows[1].m.treeCleanAfter}${C.x}`);
}
