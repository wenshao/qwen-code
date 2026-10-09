// Round-3 evidence cards for PR #13545 (head ffd7b22).
import fs from 'node:fs';
import { card, esc } from './card.mjs';
const RIG = '/Users/wenshao/pr13545-rig';
const cls = (s) => (/^(fixed|holds|pass|green|identical|12\/12|115\/115|15\/15|6\/6|0 )/i.test(s) ? 'ok' : /^(stands)/i.test(s) ? 'warn' : '');
function grid(head, rows, colorCol) {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="${i === colorCol ? cls(String(c)) : ''}">${esc(String(c))}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}
const write = (name, html) => fs.writeFileSync(`${RIG}/fig/${name}.html`, html);

write('r3-01-status', card({
  title: 'Round 3 at ffd7b22: status of every earlier finding (re-measured, not quoted)',
  sub: 'Previous report: issuecomment-6078678178 at a3022f1 (measured at b8f004f). Delta since: two merges of main (#13572 channel runtime, #13621 replay floor, …) + 84f3669; the hand-written part is contract/docs/V56/test text plus 3 Java comment lines.',
  blocks: [{ table: grid(['#', 'finding (round)', 'severity', 'status at ffd7b22', 'measurement'], [
    ['1', 'MariaDB lane: migration pins (R2, ba1e8d7)', 'CI red', 'fixed — holds', 'pins now …"54","55","56" and +6; CI MariaDB lane green'],
    ['2', 'Hosted IT runFiles:734 (R2, ba1e8d7)', 'CI red', 'fixed — holds', 'macOS 4/0 (+1 Linux-only skip); Linux arm64 5/5 incl. durableClose; CI Hosted lane green'],
    ['3', 'out-of-enum role → 400 / settlement loop (R2)', 'defense', 'fixed — holds', 'state V 6/6 identical to 02de4b1: 404, settles on attempt 0'],
    ['4', 'V54 collided with main (R2 merge)', 'blocker', 'fixed — holds (now V56)', 'main took V55 for channels; V55 → V56 upgrade boots; Flyway uniqueness incl. "latest main" green'],
    ['5', 'child close cascade after merging main (R2)', 'blocker', 'fixed — holds', 'SessionLifecycleCoordinatorTest 12/12 at head and on the trial merge with f20ed55 (H4c)'],
    ['6', 'README generation-adoption prose swallowed by a merge (review 5468003961, P2)', 'P2 docs', 'fixed — holds', 'a3022f1 restored it; ffd7b22 keeps main\'s 3 anchor phrases (3/3 vs main)'],
    ['7', 'PR description: "admitted cwd change still commits" (F3)', 'nit', 'stands', 'description unchanged; real stack: initiator demoted while parked → fail 3/3'],
    ['8', 'registry walk misses a route declared weaker (F4, yiliang114 note 3)', 'test gap', 'stands', 'R3 mutant survives 181/181; the +30 candidate still applies, 181 green, kills R3'],
    ['9', 'main bug: demoted creator\'s respond → 202 never settles (R2 observation)', 'fixed by PR', 'fixed — holds', 'state B identical (409) at head and trial merge'],
    ['10', 'PR body cites contract v1.36 / openapi 1.36.0 and "pre-V54 rows" (yiliang114, new this round)', 'nit', 'stands', 'body: 8× v1.36, 2× 1.36.0, 1× pre-V54 — tree is 1.37.0 / V56'],
  ], 3) }],
}));

const m = (f) => JSON.parse(fs.readFileSync(`${RIG}/out/${f}`, 'utf8'));
write('r3-02-real-stack', card({
  title: 'Real stack at ffd7b22: role matrix, cwd settlement and the upgrade from current main',
  sub: 'Spring jar + packaged Hosted Harness (bundle built per arm) + scripted model + MySQL 8.4.7, real HTTP with the trusted actor header; reference = the ba1e8d7 cells of round 2 (whose base→head diff was 46 contract changes, 69 unchanged).',
  blocks: [{ table: grid(['arm', 'what ran', 'result'], [
    ['main f20ed55 (control)', 'state A on a fresh DB', '53/53 identical to base fbde5cf — main still has pre-PR semantics'],
    ['head ffd7b22, DB seeded by main f20ed55', 'boot (Flyway 55 → 56) + states A/O/L/B/C', '115/115 identical to ba1e8d7'],
    ['head ffd7b22, fresh DB', 'states A/O/L/B/C', '115/115 identical'],
    ['head ffd7b22', 'state D (cwd settlement parked by the SQL relay)', '15/15 identical: initiator / creator / creator-self demoted → fail; control and bystander → commit'],
    ['head ffd7b22', 'state V (CHECK dropped, role=\'BOGUS\')', '6/6 identical to 02de4b1'],
    ['trial merge 8ea2e76 = main f20ed55 + ffd7b22', 'states A/O/L/B/C + D', '115/115 + 15/15 identical'],
  ], 2) }],
}));

write('r3-03-suites', card({
  title: 'Suites, contract and CI at ffd7b22',
  sub: 'Hosted MySQL ITs also run in CI; the local legs cross-check them, and the trial merge covers what CI cannot (current main).',
  blocks: [{ table: grid(['run', 'result'], [
    ['H2 suite, head (mvn clean test)', '1522 run, 0 failures, 0 errors, 1 skipped'],
    ['H2 suite, trial merge with f20ed55', '1525 run, 0 failures, 0 errors, 1 skipped (SessionLifecycleCoordinator 12/12, ChildResultRelay 40/40, channel service/contract tests green)'],
    ['-Pmysql-integration, head, MySQL 8.4.7', '127 run, 1 error: ManagedAgentMySqlIT hook admission "writer grant is stale" at 60.1–60.6 s — control: main f20ed55 fails identically at the same host load; CI MariaDB lane runs it green'],
    ['HostedPublicWorkspaceIT, head', 'macOS 4 run, 0 failures, 1 skipped (Linux-only) · Linux arm64 5 run, 0 failures (incl. durableClose)'],
    ['Web Shell (touched suites / generate:managed-agent-api / prettier)', '87/87 · zero drift · clean'],
    ['OpenAPI vs main f20ed55', '58/58 paths, 134/134 schemas, no operation missing or extra (comparator positive control: dropping one path + one schema is reported); version 1.37.0; changelog v1.33, v1.35, v1.36, v1.37 (main itself never had v1.34)'],
    ['CI @ ffd7b22', 'all lanes green incl. Hosted process fault gates / MySQL 8.4, MariaDB, Flyway uniqueness and "Flyway uniqueness (latest main)"'],
    ['merge-order', 'V56 is also claimed by 7 open PRs: #13682 #13654 #13642 #13598 #13554 #13530 #13325'],
  ], -1) }],
}));
console.log('built r3');
