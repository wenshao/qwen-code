// Derive assertions.json from the artifacts the harnesses actually wrote.
// Every harness encodes its own pass/fail; this only sums them, so a number in
// the report cannot drift from a number a harness produced.
//
// A cell that is EXPECTED to be red (an A/B control) counts as a pass when it
// is red as predicted — that is how each harness already encodes it, so `fail`
// here counts only unexpected outcomes.
//
// Usage: node aggregate.mjs <artifactDir>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const art = process.argv[2];
if (!art) throw new Error('usage: aggregate.mjs <artifactDir>');
const logs = path.join(art, 'logs');
const read = (n) => readFileSync(path.join(logs, n), 'utf8');
const json = (n) => JSON.parse(read(n));

const sources = [];
const add = (name, pass, fail, total) => sources.push({ name, pass, fail, total });

const ab = json('ab-help.json');
add('ab-help.mjs (help text A/B, base vs head)', ab.pass, ab.fail, ab.results.length);

const truth = json('truth.json');
add('compare-truth.mjs (claims vs runtime, both arms)', truth.pass, truth.fail, truth.results.length);

for (const arm of ['base', 'head']) {
  const h = json(`hooks-${arm}.json`);
  add(`probe-hooks.mjs [${arm}] (H1-H6 hook scope)`, h.pass, h.fail, h.results.length);
}

const ci = json('ci-junit.json');
add('ci-junit.mjs (CI own test-results artifact, independent corroboration)', ci.pass, ci.fail, ci.results.length);

const g = json('gates.json');
add('gates.mjs (isolation, diff, bundle control, merge, gates, lint, flakes, acceptance criteria)',
  g.pass, g.fail, g.results.length);

// Mutation matrix: three assertions about the matrix as a whole, computed by
// mutation-summary from mutants-r3-head.jsonl.
const rows = read('../harnesses/results/mutants-r3-head.jsonl').trim().split('\n').map(JSON.parse);
const control = rows.find((r) => r.id === 'M0');
const mutants = rows.filter((r) => r.id !== 'M0');
const killed = mutants.filter((r) => r.verdict === 'killed');
const byAssertion = mutants.filter((r) => /AssertionError|expected/.test(r.reason || ''));
add('mutate.mjs (M0 control green, 9/9 killed, every kill an assertion failure)',
  (control?.verdict === 'survived' ? 1 : 0) + (killed.length === mutants.length ? 1 : 0) + (byAssertion.length === mutants.length ? 1 : 0),
  (control?.verdict === 'survived' ? 0 : 1) + (killed.length === mutants.length ? 0 : 1) + (byAssertion.length === mutants.length ? 0 : 1),
  3);

const pass = sources.reduce((a, s) => a + s.pass, 0);
const fail = sources.reduce((a, s) => a + s.fail, 0);
const total = sources.reduce((a, s) => a + s.total, 0);

for (const s of sources) console.log(`${String(s.pass).padStart(4)}/${String(s.total).padEnd(4)} ${s.name}`);
console.log(`${'-'.repeat(70)}`);
console.log(`${String(pass).padStart(4)}/${String(total).padEnd(4)} TOTAL, ${fail} unexpected failure(s)`);
console.log(`mutation detail: control=${control?.verdict}, killed ${killed.length}/${mutants.length}, by-assertion ${byAssertion.length}/${mutants.length}`);

const out = { pass, fail, total };
writeFileSync(path.join(art, 'assertions.json'), JSON.stringify(out) + '\n');
console.log(`\nwrote assertions.json: ${JSON.stringify(out)}`);
process.exit(fail === 0 && pass === total ? 0 : 1);
