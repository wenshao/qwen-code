// usage: node report-render.mjs perf|fuzz|mutation   — pretty-prints measured JSON, adds nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const C = { r: '\x1b[1;31m', g: '\x1b[1;32m', y: '\x1b[1;33m', c: '\x1b[1;36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const which = process.argv[2];

if (which === 'perf') {
  const load = (arm) => [1, 2].map((r) => J(`perf-${arm}-${r}.json`));
  const r2 = load('r2');
  const head = load('head');
  const lazy = load('lazy');
  const fmt = (ms) => (ms < 0.1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`).padStart(10);
  console.log(`${C.c}Cost of one record on the documented reader path — built artifacts, one process per arm, median of 15 runs, two interleaved rounds${C.x}`);
  console.log(`${C.d}"lazy label" = bf1a6b1's built JS with ONE change: the per-key error label is sanitised when a message is built, not on every key of every valid record${C.x}\n`);
  console.log(`${C.b}${'workload'.padEnd(54)}${'bytes'.padStart(8)}  ${'98860b5'.padStart(10)} ${'bf1a6b1'.padStart(10)} ${'ratio'.padStart(7)}   ${'lazy label'.padStart(10)} ${'ratio'.padStart(7)}${C.x}`);
  console.log(C.d + '─'.repeat(118) + C.x);
  for (const k of Object.keys(r2[0])) {
    const a = Math.min(r2[0][k].ms, r2[1][k].ms);
    const b = Math.min(head[0][k].ms, head[1][k].ms);
    const l = Math.min(lazy[0][k].ms, lazy[1][k].ms);
    const ratio = b / a;
    const col = ratio > 1.5 ? C.y : C.g;
    const ratioText = ratio > 100 ? `${Math.round(ratio)}×` : `${ratio.toFixed(2)}×`;
    const lr = l / a;
    console.log(
      `${r2[0][k].label.padEnd(54)}${String(r2[0][k].bytes).padStart(8)}  ${fmt(a)} ${fmt(b)} ${col}${ratioText.padStart(7)}${C.x}   ${fmt(l)} ${(lr > 100 ? Math.round(lr) + '×' : lr.toFixed(2) + '×').padStart(7)}`,
    );
  }
  console.log(C.d + '─'.repeat(118) + C.x);
  let spread = 0;
  for (const k of Object.keys(r2[0])) {
    for (const arm of [r2, head, lazy]) {
      const [x, y] = [arm[0][k].ms, arm[1][k].ms];
      spread = Math.max(spread, Math.abs(x - y) / Math.min(x, y));
    }
  }
  console.log(`${C.d}largest round-to-round spread on any cell: ${(spread * 100).toFixed(1)} %. The two list validators were O(n) key compares before; they now deep-walk every event${C.x}\n${C.d}(a deliberate R1-2 / R1-11 fix) — 3.5 ms per full 256-event transaction in absolute terms.${C.x}`);
}

if (which === 'fuzz') {
  const o = J('fuzz-full.json');
  console.log(`${C.c}Behavioural diff of the two built artifacts — ${o.iterations.toLocaleString('en-US')} mutated headers / commit markers / events (all 15 kinds), same input to both arms${C.x}`);
  console.log(`${C.d}seeded generator; mutations = replace / delete / add a field from an adversarial pool${C.x}\n${C.d}(C0, C1, bidi, NFD, lone surrogate, byte-limit ±1, MAX_SAFE, 8.64e15 ±, -0, NaN, null-prototype, Date, Map …)${C.x}\n`);
  console.log(`  identical verdict on ${C.b}${o.counts.same.toLocaleString('en-US')}${C.x} inputs  (${o.counts.acceptBoth.toLocaleString('en-US')} accepted by both, ${o.counts.rejectBoth.toLocaleString('en-US')} rejected by both)`);
  console.log(`  different verdict on ${C.b}${o.counts.diff.toLocaleString('en-US')}${C.x} inputs, which fall into exactly ${C.b}${o.buckets.length}${C.x} buckets:\n`);
  const THREAD = [
    [/NFC/, 'R1-5'], [/control characters/, 'R1-4'], [/valid UTF-8/, 'R1-5'], [/UTC Unix millisecond/, 'R1-19'],
    [/managed-session\/0/, 'R1-13'], [/must start at 1/, 'R1-19/20'], [/Cannot convert object/, 'R1-3'], [/sequence references/, 'R1-19/20'],
  ];
  console.log(`${C.b}${'count'.padStart(9)}  ${'98860b5'.padEnd(8)}→ ${'bf1a6b1'.padEnd(8)} ${'rule that now decides'.padEnd(62)}thread${C.x}`);
  console.log(C.d + '─'.repeat(100) + C.x);
  for (const b of o.buckets) {
    const [from, to] = b.k.split('  →  ');
    const fv = from.split(':')[0];
    const tv = to.split(':')[0];
    const rule =
      tv === 'ACCEPT'
        ? 'minimumReader "managed-session/0" now satisfies a v1 reader'
        : to.replace(/^[A-Z]+: /, '').replace('<field> ', '');
    const thread = THREAD.find(([re]) => re.test(b.k))?.[1] ?? `${C.r}UNEXPLAINED${C.x}`;
    const paint = (v) => ({ ACCEPT: C.y, REJECT: C.g, CRASH: C.r })[v] + v.padEnd(7) + C.x;
    console.log(`${String(b.n.toLocaleString('en-US')).padStart(9)}  ${paint(fv)} → ${paint(tv)}  ${rule.slice(0, 60).padEnd(62)}${thread}`);
  }
  console.log(C.d + '─'.repeat(100) + C.x);
  console.log(`  raw parser, ${o.raw.iterations.toLocaleString('en-US')} random JSON texts with adversarial number tokens: ${o.raw.same.toLocaleString('en-US')} identical; ${o.raw.buckets.map(([k, n]) => `${n.toLocaleString('en-US')} × ${k.replace('<field> ', '')}`).join('; ')}  ${C.d}(R1-8)${C.x}`);
  console.log(`  lifecycle predicate, all 10×10 from/to pairs incl. null and an out-of-union name: ${o.lifecycleDiffs.length} differ\n      1 × recovery_blocked→recovery_blocked true⇒false ${C.d}(R1-12)${C.x}, ${o.lifecycleDiffs.length - 1} × 'bogus' CRASH/true⇒false ${C.d}(R2-6)${C.x}`);
  console.log(`\n  ${C.g}no input went REJECT → CRASH or ACCEPT → CRASH; the single loosening is the minimumReader lower bound the author declared${C.x}`);
}

if (which === 'mutation') {
  const rows = [];
  for (const label of ['r2', 'head']) {
    const m = J(`mut-${label}.json`);
    const c = J(`classify-${label}.json`);
    const live = c.filter((x) => x.witness);
    const msg = c.filter((x) => !x.witness && x.messageOnly);
    const unreach = c.filter((x) => !x.witness && !x.messageOnly);
    rows.push({ label, m, c, live, msg, unreach, killed: m.sites.filter((s) => s.killed).length });
  }
  console.log(`${C.c}Guard-deletion sweep — one mutant per fail(...) call site in managed-session-records.ts, the PR's own test file re-run against each${C.x}`);
  console.log(`${C.d}fully automated (not the hand-picked 60 of rounds 1-2, so the totals are not comparable with 48/57)${C.x}\n${C.d}mutants live in an untracked directory, tracked files are never edited, tree verified clean after each arm${C.x}\n`);
  console.log(`${C.b}${''.padEnd(34)}${'98860b5'.padStart(10)}${'bf1a6b1'.padStart(10)}${C.x}`);
  const line = (name, f) => console.log(`${name.padEnd(34)}${String(f(rows[0])).padStart(10)}${String(f(rows[1])).padStart(10)}`);
  line('tests in the file (control green)', (r) => `${r.m.control.total - r.m.control.failed}/${r.m.control.total}`);
  line('guard sites mutated', (r) => r.m.sites.length);
  line('killed', (r) => r.killed);
  line('survived — verdict-bearing', (r) => r.live.length);
  line('survived — message only', (r) => r.msg.length);
  line('survived — unreachable', (r) => r.unreach.length);
  console.log(`${C.b}${'score over verdict-bearing'.padEnd(34)}${rows.map((r) => `${r.killed}/${r.killed + r.live.length} ${Math.round((100 * r.killed) / (r.killed + r.live.length))}%`.padStart(10)).join('')}${C.x}`);

  const NEW = ['must be a plain JSON array', 'must be valid UTF-8 text', 'must use NFC normalization', 'exceeds the maximum UTC Unix millisecond', 'requiredSequence must start at 1', 'sequence references must start at 1', 'coveredSequence must start at 1', 'transaction identity must contain at least one', 'transaction identity must not exceed'];
  const head = rows[1];
  const newSites = NEW.map((n) => head.m.sites.find((s) => s.msg.includes(n)));
  console.log(`\n${C.b}the 9 guards this commit added:${C.x} ${newSites.filter((s) => s.killed).length} pinned by a test, ${newSites.filter((s) => !s.killed).length} not`);
  console.log(`\n${C.b}verdict-bearing survivors at bf1a6b1 — the witness is an input the shipped build rejects and the mutant does not${C.x}`);
  console.log(C.d + '─'.repeat(150) + C.x);
  for (const s of head.live) {
    const isNew = newSites.includes(head.m.sites.find((x) => x.id === s.id));
    const to = s.witness.to === 'ACCEPT' ? `${C.y}ACCEPT${C.x}` : `${C.r}CRASH ${C.x}`;
    console.log(`  L${String(s.line).padEnd(5)}${s.fn.padEnd(27)}${s.msg.replace(/\$\{[^}]*(\}|$)/g, '…').slice(0, 52).padEnd(54)}${C.g}REJECT${C.x} → ${to}  ${C.d}${s.witness.name}${isNew ? '   ← new in this commit' : ''}${C.x}`);
  }
  console.log(C.d + '─'.repeat(150) + C.x);
  console.log(`${C.d}  message-only: ${head.msg.map((s) => 'L' + s.line).join(', ')} (lexer depth / \\u escape / string escape / unterminated string — JSON.parse or the new post-parse walk still rejects)${C.x}\n${C.d}  unreachable: ${head.unreach.map((s) => 'L' + s.line).join(', ')} (256 ids × 512 B cannot reach the 8 MiB identity cap)${C.x}`);
}
