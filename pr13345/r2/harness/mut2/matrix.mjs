// Folds r2/results/mutants.tsv into a per-mutant old/new verdict.
// Fails closed: a lane whose total differs from that arm's baseline (or has
// no report) is INVALID, never "survived".
import fs from 'node:fs';
import { MUTANTS } from './mutants.mjs';
const ARMS = ['old', 'new'];

const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad';
const NOISE = [
  /managed-session-record-sink\.test\.ts :: .*carries branch points/,
  /managed-session-metadata\.test\.ts :: .*bounded tail window/,
  /^ToolPublicationStoreTest\./,
  /^ToolPublicationRecoveryTest\./,
];
const rows = fs
  .readFileSync(`${S}/r2/results/mutants.tsv`, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('RESULT\t'))
  .map((l) => {
    const [, arm, id, lane, , total, failed, names] = l.split('\t');
    return {
      arm,
      id,
      lane,
      total: Number(total.split('=')[1]),
      failed: Number(failed.split('=')[1]),
      names: names ? names.split(' | ').filter(Boolean) : [],
      raw: l,
    };
  });
const baseline = {};
for (const r of rows.filter((r) => r.id.startsWith('M00-'))) {
  baseline[`${r.arm}/${r.lane}`] = r.total;
}
const out = [];
for (const m of MUTANTS) {
  const entry = { id: m.id, desc: m.desc, arms: {} };
  for (const arm of ARMS) {
    if (!m.arms.includes(arm)) {
      entry.arms[arm] = { verdict: 'n/a' };
      continue;
    }
    const lanes = rows.filter((r) => r.arm === arm && r.id === m.id);
    if (lanes.length !== m.lanes.length) {
      entry.arms[arm] = { verdict: 'PENDING' };
      continue;
    }
    const red = [];
    const noise = [];
    let invalid = null;
    for (const r of lanes) {
      const expected = baseline[`${arm}/${r.lane}`];
      const fileError = r.names.some((n) => n.includes('FILE_ERROR'));
      if (!(r.total > 0) || (r.total !== expected && !fileError && m.id !== 'A-D06-historyCases-emptied')) {
        invalid = `${r.lane} total=${r.total} baseline=${expected}`;
      }
      for (const n of r.names) {
        (NOISE.some((p) => p.test(n)) ? noise : red).push(`${r.lane}: ${n}`);
      }
    }
    entry.arms[arm] = {
      verdict: invalid ? 'INVALID' : red.length ? 'KILLED' : 'SURVIVED',
      invalid,
      red,
      noise,
      totals: lanes.map((r) => `${r.lane}=${r.total}`).join(' '),
    };
  }
  out.push(entry);
}
fs.writeFileSync(`${S}/r2/results/matrix.json`, JSON.stringify(out, null, 2));
for (const e of out) {
  console.log(`${e.id.padEnd(36)} old=${e.arms.old.verdict.padEnd(8)} new=${e.arms.new.verdict}`);
  for (const arm of ARMS) {
    const a = e.arms[arm];
    if (a.invalid) console.log(`    ${arm} INVALID ${a.invalid}`);
    for (const r of a.red ?? []) console.log(`    ${arm} RED ${r.slice(0, 200)}`);
  }
}
