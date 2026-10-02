// VERIFICATION RIG ONLY (PR #13135 round 3): upgrade paths into head d7c5c5e50e.
import fs from 'node:fs';
import { figs, render, page, table, OK, WARN, res, RIG } from './figlib.mjs';
const up = res('lb2', 's7-upgrade-close-head2');
const v28 = fs.readFileSync(`${RIG}/out/run-r2c.out`, 'utf8') && fs.readFileSync(`${RIG}/run/lx-l1/spring-11.log`, 'utf8').match(/Migration checksum mismatch for migration version \d+/)?.[0];
const v30 = fs.readFileSync(`${RIG}/out/u3-provisional-v30-startup.txt`, 'utf8').match(/Migration checksum mismatch for migration version \d+/)?.[0];
figs['04-round3'] = page(
  'Round 3 — head d7c5c5e50e unchanged; upgrade paths into it',
  'No code change since round 2 (same head), so the round-2 real-stack results apply. This round checks the remaining upgrade path the author listed as untested. Flyway schema history on the left is what the database recorded before starting the current head jar.',
  table(
    ['Database before upgrade', 'Its versions ≥ V28', 'Start head d7c5c5e50e'],
    [
      ['main <code>49b6c90053</code> (round 2)', 'V28/V29 Hook admission, V30 tool-output retention', OK(`V31 applied; ${up.pass}/${up.pass + up.fail} pre-existing bound Sessions closed`)],
      ['earlier PR build <code>6c6e58441a</code> (round 2)', 'V26/V27 main, <b>V28 workspace session close</b>', WARN(`refuses to start: <code>${v28}</code>`)],
      ['earlier PR build <code>0b9ad071e5</code> (new)', 'V28/V29 Hook admission, <b>V30 workspace session close</b>', WARN(`refuses to start: <code>${v30}</code>; history untouched (30 rows, no V31)`)],
    ],
  ) + `<div class="note">Both provisional numberings fail the same way. Any database that ran an earlier build of this PR has to be recreated (or hand-repaired) before it can run this build; main databases upgrade cleanly.</div>`,
);
await render(['04-round3']);
