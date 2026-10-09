// Builds the evidence cards for PR #13545 from the rig's recorded cells.
import fs from 'node:fs';
import { card, esc } from './card.mjs';
const RIG = '/Users/wenshao/pr13545-rig';
const load = (n) => JSON.parse(fs.readFileSync(`${RIG}/out/cells-${n}.json`, 'utf8'));
const base = load('base'), head = load('head'), mut = load('facts-mut'), dHead = load('d-head'), dBase = load('d-base-rollback');

function summ(v) {
  if (!v) return '—';
  let s = String(v.status);
  if (v.code) s += ' ' + v.code;
  const t = typeof v.turn === 'string' ? v.turn : null;
  if (t) s += ' → Turn ' + t;
  if (v.state) s += ' → op ' + v.state + (v.failure ? ` (${v.failure})` : '');
  if (v.op && v.op.state) s += ' → op ' + (v.op.state.startsWith('NOT_SETTLED') ? 'never settles' : v.op.state);
  return s;
}
const cls = (s) => (/^20[02]/.test(s) ? 'ok' : /^40[34]/.test(s) ? '' : /^409/.test(s) ? 'warn' : '');
function grid(head_, rows, changedCol) {
  return `<table><thead><tr>${head_.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => {
      const s = String(c);
      const changed = changedCol && i === changedCol && r[changedCol] !== r[changedCol - 1];
      return `<td class="${i === 0 ? '' : cls(s)}${changed ? ' chg' : ''}">${esc(s)}${changed ? ' ◀' : ''}</td>`;
    }).join('')}</tr>`)
    .join('')}</tbody></table>`;
}
const ACT = { cr: 'cr  (creator, OPERATOR)', op2: 'op2 (OPERATOR)', ow2: 'ow2 (OWNER, not creator)', rd: 'rd  (READER)', nn: 'nn  (no grant)', anon: 'anonymous' };
const diff = JSON.parse(fs.readFileSync(`${RIG}/out/diff.json`, 'utf8'));
const write = (name, html) => fs.writeFileSync(`${RIG}/fig/${name}.html`, html);

// ---------- 01: state A matrix ----------
{
  const rows = [];
  for (const [fam, label] of [['submit', 'Turn submit'], ['cancel', 'Turn cancel'], ['rename', 'rename (PATCH)'], ['cwd', 'cwd change'], ['respond', 'approval respond']]) {
    for (const X of ['cr', 'op2', 'ow2', 'rd', 'nn']) {
      const k = fam === 'rename' ? `A|rename|pub|${X}` : `A|${fam}|pub|${X}`;
      rows.push([`${label} · ${ACT[X]}`, summ(base[k]), summ(head[k])]);
    }
  }
  for (const X of ['cr', 'op2', 'ow2', 'rd']) rows.push([`WebShell capabilities.workspaceTurns · ${ACT[X]}`, String(base[`A|cap|${X}`].get.workspaceTurns), String(head[`A|cap|${X}`].get.workspaceTurns)]);
  for (const X of ['cr', 'ow2']) rows.push([`archive, owner_actor_key=ow2 (set out of band) · ${ACT[X]}`, summ(base[`O|archive|pub|${X}`]), summ(head[`O|archive|pub|${X}`])]);
  write('01-role-matrix', card({
    title: 'Real stack: who may act on a bound Session — main (base) vs PR head',
    sub: `Spring fat jar + packaged Hosted Harness + scripted model + MySQL 8.4.7, real HTTP with the trusted actor header; head boots on the base-seeded DB (V53 → V54 applied). Public surface shown; the WebShell surface answered identically in all 45/45 pairs on both arms.`,
    blocks: [
      { h: 'State A — every actor holds its role, Workspace ACTIVE (◀ = changed by the PR)', table: grid(['family · caller', 'base fbde5cf (main)', 'head ba1e8d7 (= 02de4b1, re-run 115/115)'], rows, 2) },
      { note: `${diff.total} comparable cells across states A/O/L/B/C: ${diff.same} identical, ${diff.changed.length} changed — every change is a v1.34 contract line (OPERATOR widening, 409→403 below OPERATOR, owner_actor_key for lifecycle, creator-facts 409, cancel exemption). Each admitted 202 executed for real (Turn COMPLETED / CANCELLED, file written by the approved write_file, cwd moved); every refused submit left zero new Turns, PENDING commands and model requests (per-cell deltas recorded); refused approval answers were then answered by cr, hence "→ Turn COMPLETED". workspaceTurns mirrored submit admission in 18/18 (actor × state × surface) on both arms.` },
    ],
  }));
}

// ---------- 02: creator demoted ----------
{
  const rows = [];
  const add = (label, k) => rows.push([label, summ(base[k]), summ(head[k]), summ(mut[k])]);
  for (const X of ['cr', 'op2', 'ow2', 'rd']) add(`submit · ${ACT[X]}`, `B|submit|pub|${X}`);
  for (const X of ['cr', 'op2']) add(`cwd · ${ACT[X]}`, `B|cwd|pub|${X}`);
  for (const X of ['rd', 'op2', 'ow2', 'cr']) add(`respond to an approval raised before the demotion · ${ACT[X]}`, `B|respond|pub|${X}`);
  rows.push(['cancel a Turn admitted before the demotion · op2', summ(base['B|cancel|pub|op2']), summ(head['B|cancel|pub|op2']), '(not measured: held reply timed out first)']);
  rows.push(['state-B totals (new Turns / operations / model requests)', `${base['B|totals'].turns} / ${base['B|totals'].ops} / ${base['B|totals'].turnReq}`, `${head['B|totals'].turns} / ${head['B|totals'].ops} / ${head['B|totals'].turnReq}`, `${mut['B|totals'].turns} / ${mut['B|totals'].ops} / ${mut['B|totals'].turnReq}`]);
  write('02-creator-demoted', card({
    title: 'Only the creator is demoted to READER — admission certifies the creator-keyed execution facts',
    sub: 'Same stack. Mutant = head with both facts gates removed (maySubmitWorkspaceTurn conjunct + the ManagedActionStore respond gate), built and run the same way: it shows what the gates prevent.',
    blocks: [
      { table: grid(['family · caller', 'base (main)', 'head', 'head minus facts gates (mutant)'], rows) },
      { note: 'Head refuses synchronously: 403 below OPERATOR, 409 workspace_unavailable for an OPERATOR — zero Turns, operations or model requests in state B. Without the gates the same calls get 202: 4 Turns FAIL asynchronously (workspace_unavailable) and 6 approval answers stay RUNNING/PENDING with attempt_count 5–7, never settling. Base (current main) already has that dead-arbiter 202 for the demoted creator\'s own answer; this PR closes it. The cancel exemption holds: op2 aborts the running Turn.' },
    ],
  }));
}

// ---------- 03: V54 cwd settlement ----------
{
  const rows = [];
  const lab = { control: 'no demotion (control)', 'initiator-demoted': 'initiator op2 → READER', 'creator-demoted': 'creator cr → READER', 'creator-self': 'cr initiates, cr → READER', 'bystander-demoted': 'bystander ow2 → READER' };
  for (const l of Object.keys(lab)) {
    const hs = [0, 1, 2].map((i) => dHead[`D|${l}|${i}`]);
    const bs = [0, 1, 2].map((i) => dBase[`D|${l}|${i}`]);
    const fmt = (arr) => {
      const c = {};
      for (const v of arr) { const s = summ(v); c[s] = (c[s] ?? 0) + 1; }
      return Object.entries(c).map(([s, n]) => `${n}× ${s}`).join('; ');
    };
    rows.push([lab[l], fmt(bs), fmt(hs), hs[0]?.actorKeyHex ? `${hs[0].actorKeyHex} / ${bs.find((b) => b.actorKeyHex)?.actorKeyHex ?? '—'}` : '—']);
  }
  write('03-cwd-v54-settlement', card({
    title: 'cwd change: the demotion lands between admission and settlement (deterministic)',
    sub: 'Spring\'s JDBC goes through a byte relay that parks the settlement\'s own "SELECT lease_until … FOR UPDATE" for that Session; the rig demotes the actor on a direct connection, then releases it. Without the hold, settlement finishes ~30 ms after the 202 and a demotion never lands in time.',
    blocks: [
      { table: grid(['demotion while settlement is parked', 'base jar on the V54 DB (rollback)', 'head', 'actor_key (head / base)'], rows) },
      { note: 'Head: the V54 initiator re-check works — demoting the initiator or the creator fails the admitted change with workspace_unavailable; demoting an unrelated operator does not. Base jar boots on the V54 schema and writes actor_key NULL (the pre-V54 shape head settles on creator facts alone). This contradicts the PR description\'s "a cwd operation admitted before its initiator\'s own demotion still commits" (stale; the code, contract v1.34 and settlementFailsAnAdmittedChangeWhenOnlyTheInitiatorDropped say it fails).' },
    ],
  }));
}

// ---------- 04: CI red legs ----------
{
  const L = JSON.parse(fs.readFileSync(`${RIG}/out/linux-it.json`, 'utf8'));
  const N = JSON.parse(fs.readFileSync(`${RIG}/out/newhead.json`, 'utf8'));
  const rows = [
    ['MariaDB lane · WorkspaceMigrationMySqlIT:65', 'containsExactly("48".."53") — got … "53", "54"', '02de4b1: add "54" ✔'],
    ['MariaDB lane · WorkspaceSessionRetentionMySqlIT:356', 'hasSize(originalClose.size() + 5) — got +6 (actor_key)', '02de4b1: +6 and containsEntry("actor_key", null) ✔'],
    ['MySQL 8.4 lane · HostedPublicWorkspaceIT publicCreation / durableClose[1] / [2] → runFiles:734', 'Expected size 14 but was 15 — modelsBefore read at :705, before the held Turn\'s own model request', '02de4b1: hasSize(modelsBefore + 1) ✔'],
  ];
  const runs = [
    ['CI @ ba1e8d7 · MariaDB lane / MySQL 8.4 lane', '126 run, 2 failures / hosted-harness-mysql 21 run, 3 failures'],
    ['local ba1e8d7 · -Pmysql-integration MySQL 8.4.7 and MariaDB 10.11.18', '126 run, 2 failures each (identical to CI)'],
    ['local ba1e8d7 · HostedPublicWorkspaceIT macOS / Linux arm64', '4 run, 1 failure (+1 Linux-only skip) / ' + L.head],
    ['local 02de4b1 · -Pmysql-integration MySQL 8.4.7', N.mysqlIts],
    ['local 02de4b1 · HostedPublicWorkspaceIT macOS / Linux arm64', N.hostedMac + ' / ' + N.hostedLinux],
    ['local 02de4b1 · H2 suite (mvn test)', N.h2],
    ['CI @ 02de4b1 · Flyway migration version uniqueness', 'fail — the merge ref carried main\'s V54 (fixed at b8f004f, see 07)'],
    ['CI @ b8f004f · MariaDB lane / Flyway uniqueness', 'pass / pass'],
  ];
  write('04-ci-red-leg', card({
    title: 'The two red lanes at ba1e8d7 were test defects — fixed in 02de4b1 (verified locally; MariaDB lane green in CI at b8f004f)',
    sub: 'The pins run only under -Pmysql-integration and the Hosted IT only under -Phosted-harness-mysql; the H2 suite runs neither. The author\'s fix uses hasSize(modelsBefore + 1) — equivalent to moving the read.',
    blocks: [
      { table: grid(['failing test at ba1e8d7', 'assertion', 'fix in 02de4b1'], rows) },
      { table: grid(['run', 'result'], runs) },
    ],
  }));
}

// ---------- 05: Web Shell UI ----------
{
  const img = (f) => `file://${RIG}/fig/raw/${f}`;
  write('05-webshell-ui', card({
    title: 'Web Shell Managed panel on the real stack (vite from each arm\'s worktree → that arm\'s Spring)',
    sub: 'Same bound Session with a pending write_file approval raised by the creator; viewer chosen per page.',
    width: 1700,
    blocks: [
      { imgs: [
        { cap: 'base · op2 (OPERATOR, not creator) presses "Yes, allow once" → 403, creator-only notice', src: img('ui-base-u2-operator-after.png') },
        { cap: 'head · op2 answers → 202, card leaves, Turn COMPLETED, file written', src: img('ui-head-u2-operator-after.png') },
        { cap: 'head · READER refused → new notice + "Retry loading approvals"', src: img('ui-head-u1-reader-refused.png') },
        { cap: 'head · same READER raised to OPERATOR → Retry → card re-enabled → answered (202); reply rendered, Turn COMPLETED in the DB', src: img('ui-head-u1b-reader-promoted-answered.png') },
        { cap: 'base · op2 on an idle bound Session: no composer (workspaceTurns=false)', src: img('ui-base-u3-composer.png') },
        { cap: 'head · op2 sends from the composer → /turns/submit 202 → Turn COMPLETED', src: img('ui-head-u3-composer-sent.png') },
      ] },
    ],
  }));
}

// ---------- 06: registry mutants ----------
{
  const m = JSON.parse(fs.readFileSync(`${RIG}/out/mutreg.json`, 'utf8'));
  const r = (k) => (m[k].exit === 0 ? (k.endsWith('none') ? 'all green' : 'SURVIVED (all green)') : 'KILLED by ' + m[k].failing.map((f) => f.replace(/SurfaceAdmissionAcceptanceTest\.belowReadAndBelowFamilyProbesFollowTheRuleClass:\d+->/, 'acceptance walk/').replace('SurfaceRegistryGateTest.', 'gate/')).join(' + '));
  const rows = [
    ['R3 PUBLIC_SESSION_RENAME OPERATOR → READER (weaker than handler)', r('base|R3 weaker'), r('head|R3 weaker'), 'KILLED by acceptance walk/expectAdmitted'],
    ['R1 WEBSHELL_TURN_SUBMIT OPERATOR → READER', r('base|R1 weaker'), r('head|R1 weaker'), 'KILLED by acceptance walk/expectAdmitted + gate/capabilityTwinsShareOneRuleClass'],
    ['R2 PUBLIC_SESSION_DELETE OWNER → OPERATOR', r('base|R2 weaker'), r('head|R2 weaker'), 'KILLED (unchanged)'],
    ['R4 PUBLIC_SESSION_GET READER → OPERATOR (stronger; control)', r('base|R4 stronger (control)'), r('head|R4 stronger (control)'), '—'],
    ['unmutated', r('base|none') + ' (173)', r('head|none') + ' (178)', 'all green (178)'],
  ];
  write('06-registry-mutants', card({
    title: 'Registry walk: a route declared weaker than its handler (yiliang114\'s third note, measured)',
    sub: 'SurfaceAdmissionAcceptanceTest + SurfaceRegistryGate*Test, one test-tree registry edit per run.',
    blocks: [
      { table: grid(['mutant', 'base (has expectAdmitted)', 'head', 'head + candidate (+30, restores expectAdmitted in the READER arm)'], rows) },
      { note: 'Head\'s READER arm probes only the stranger and anonymous callers, so an OPERATOR route re-declared READER (R3) passes everything. Non-blocking: the handler still enforces; the walk just stops catching registry drift in that direction.' },
    ],
  }));
}

// ---------- 07: merging main ----------
{
  const M = JSON.parse(fs.readFileSync(`${RIG}/out/h3.json`, 'utf8'));
  const blockers = [
    ['B1 · #13550 landed V54__managed_child_lineage_relay on main (06:04Z)', 'trial merge of ba1e8d7 / 02de4b1 with main: the jar exits at boot — FlywayException "Found more than one migration with version 54"; CI Flyway uniqueness red at 02de4b1', 'b8f004f: V55__managed_operation_actor_key — main-seeded DB (V54) upgrades to 55 in place and boots; CI Flyway uniqueness green'],
    ['B2 · #13550 child close cascade admits as "child:<parent>"', 'trial merge (rename only): SessionLifecycleCoordinatorTest 4/12 (main 12/12) — the child row copies the parent\'s creator_actor_key, owner NULL, so owner → creator → command answered 403 and the parent close re-armed forever', 'b8f004f (5e3d39f): isSessionOwner = owner → create command → creator — the class is 12/12'],
  ];
  const after = [
    ['H2 suite (mvn clean test)', M.h2],
    ['-Pmysql-integration on MySQL 8.4.7', M.mysqlIts],
    ['HostedPublicWorkspaceIT, macOS + MySQL 8.4.7', M.hostedMac],
    ['HostedPublicWorkspaceIT, Linux arm64 + MySQL 8.4 (incl. durableClose)', M.hostedLinux],
    ['real stack: main 5ddd438 jar seeds the DB, b8f004f upgrades it 54 → 55', '115/115 cells identical to ba1e8d7 (states A/O/L/B/C)'],
    ['real stack: cwd settlement under the SQL hold (state D)', '15/15 identical: initiator / creator / creator-self demoted → fail 3/3 each; control and bystander → commit 3/3'],
    ['real stack: out-of-enum role (state V)', 'identical to 02de4b1: 404 invisible; parked settlement fails on attempt 0'],
    ['CI @ b8f004f', M.ci],
  ];
  write('07-trial-merge', card({
    title: 'Merging main: two breaks found on the trial merge — both fixed at b8f004f (verified)',
    sub: 'Local trial merges be81824 (5ddd438 + ba1e8d7) and 8a8bd1b (669b2f0 + 02de4b1) had no textual conflicts, so GitHub showed MERGEABLE throughout. b8f004f merges 5ddd438; main 669b2f0 has the same sdk-java.',
    blocks: [
      { table: grid(['what broke', 'measured before the fix', 'fix at b8f004f, measured'], blockers) },
      { h: 'Head b8f004f3', table: grid(['run', 'result'], after) },
    ],
  }));
}

// ---------- 08: e613c69 out-of-enum role ----------
{
  const o = load('v-head'), n = load('v-h2');
  const rows = ['V|get|pub|rd', 'V|submit|pub|rd', 'V|rename|pub|rd', 'V|cwd|pub|rd'].map((k) => [k.split('|')[1] + ' · rd (stored role \'BOGUS\')', summ(o[k]), summ(n[k])]);
  rows.push(['WebShell sessions/get · rd', `${o['V|cap|rd'].get.status} ${o['V|cap|rd'].get.code}`, `${n['V|cap|rd'].get.status} ${n['V|cap|rd'].get.code}`]);
  const so = o['V|cwd-settle|pub|op2'], sn = n['V|cwd-settle|pub|op2'];
  rows.push(['cwd settlement · initiator op2 turns \'BOGUS\' while parked', `202 → op never settles (attempt_count ${so.attempts}, ${so.springEnumErrors} "No enum constant" log lines)`, `202 → op ${sn.state} (${sn.failure}), attempt_count ${sn.attempts}, ${sn.springEnumErrors} enum errors`]);
  write('08-out-of-enum-role', card({
    title: 'e613c69 (vocabulary filter): an out-of-enum stored role now fails closed',
    sub: 'Only reachable past V53\'s CHECK, so the rig drops the CHECK out of band and stores role=\'BOGUS\'. Same stack, ba1e8d7 jar vs 02de4b1 jar.',
    blocks: [{ table: grid(['probe', 'ba1e8d7', '02de4b1'], rows) }, { note: 'Before: every route answers 400 invalid_request (the IllegalArgumentException from WorkspaceAccess.valueOf), and the cwd settlement loops on its retry budget. After: the actor is simply invisible (404) and the settlement fails on its first attempt with workspace_unavailable — yiliang114\'s note 2, measured.' }],
  }));
}

console.log('built');
