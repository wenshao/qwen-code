// Renders the #12900 evidence cards to PNG (Playwright from the PR worktree).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const FIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(FIG);
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Line prefixes pick a colour: "## " heading, "++ " pass, "-- " fail, "!! " note, "== " dim.
function pre(text) {
  return `<pre>${text.split('\n').map((l) => {
    const m = /^(##|\+\+|--|!!|==) (.*)$/.exec(l);
    if (!m) return esc(l);
    const cls = { '##': 'h', '++': 'ok', '--': 'bad', '!!': 'warn', '==': 'dim' }[m[1]];
    return `<span class="${cls}">${esc(m[2])}</span>`;
  }).join('\n')}</pre>`;
}
function table(head, rows) {
  const cell = (c) => {
    const m = /^(\+\+|--|!!|==) (.*)$/.exec(c);
    return m ? `<td class="${{ '++': 'ok', '--': 'bad', '!!': 'warn', '==': 'dim' }[m[1]]}">${esc(m[2])}</td>` : `<td>${esc(c)}</td>`;
  };
  return `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>`;
}
const card = (id, title, sub, body, note) => `<section class="card" id="${id}"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;

const cards = [];

cards.push(card('c1', 'CI job replica: main (PR base 42d7a2b833) vs PR head 1f1136066e',
  'Commands copied from .github/workflows/sdk-java.yml · Zulu JDK 21.0.12 · MariaDB 10.11.18 and MySQL 8.4.11 in Docker · private Maven repo',
  table(['Step', 'main 42d7a2b833', 'PR 1f1136066e'], [
    ['MariaDB job: managed-agent-server unit tests', '-- 153 run, 88 errors · BUILD FAILURE', '++ 153 run, 0 failures, 0 errors'],
    ['ManagedAgentMySqlIT on MariaDB 10.11.18', '-- never reached ("ran no test")', '++ 11 / 11'],
    ['ManagedAgentMySqlIT on MySQL 8.4.11', '== not run separately; unit phase fails first', '++ 11 / 11'],
    ['MariaDB job: Runtime Broker unit + JdbcRuntimeBrokerMySqlIT', '== module unchanged by the PR', '++ 387 unit (2 skipped) + 2 IT'],
    ['Hosted job: unit + Hosted*IT on MySQL 8.4.11, packaged CLI', '-- 153 run, 88 errors · Hosted ITs "ran no test"', '++ 153 + HostedHarnessMySqlIT 2 + HostedWorkspaceToolTurnIT 3'],
    ['Hosted job: Runtime Broker fault gates', '== module unchanged by the PR', '++ 29 / 29 (see note)'],
    ['Checkstyle (both jobs)', '-- not reached', '++ 0 violations'],
    ['scripts/check-failsafe-reports.js (non-hosted, hosted)', '-- exit 1', '++ exit 0'],
  ]) + pre([
    '## Where the 88 errors on main come from (surefire XML, every <error> element)',
    '-- 8  FlywayException: Found more than one migration with version 16',
    '--      -> V16__runtime_loss_evidence.sql (SQL)   -> V16__managed_session_operation.sql (SQL)',
    '-- 8  Failed to load ApplicationContext ... caused by the same FlywayException',
    '-- 72 ApplicationContext failure threshold (1) exceeded: skipping repeated attempt',
    '== 0  errors with any other cause',
  ].join('\n')),
  'Every failure on main traces to the duplicate V16; on the PR head both CI jobs pass end to end. The first fault-gate run had 1 error: H2 got <code>unexpected status 1213486160</code> (= "HTTP"), i.e. another process on this shared host answered its TCP port. The rerun passed 29/29, and the module is untouched by this PR.'));

cards.push(card('c2', 'Which database each server jar starts on',
  'java -jar <server jar> against fresh schemas · MySQL 8.4.11 and MariaDB 10.11.18 give identical results · Harness and Broker disabled',
  pre([
    '## A  main 42d7a2b833 (two V16) on an empty schema',
    '-- REFUSED  FlywayException: Found more than one migration with version 16',
    '== after:   0 tables, no flyway_schema_history  -> Flyway resolves before it applies anything',
    '',
    '## B  one schema, three jars in turn',
    '++ B1 main d66fdadd27 (W0e only; main 05:15-05:38 UTC) starts',
    '==    #16 V16 "runtime loss evidence"       checksum=2104958993',
    '-- B2 main 42d7a2b833 REFUSED (duplicate V16); schema history unchanged: true',
    '++ B3 PR jar starts and applies only V17',
    '==    #16 V16 "runtime loss evidence"       checksum=2104958993',
    '==    #17 V17 "managed session operation"   checksum=1110071400',
    '',
    '## C  schema first migrated by the #12881 branch head a32bd7976b (D4 as V16)',
    '++ C1 #12881 head starts:  #16 V16 "managed session operation"  checksum=1110071400',
    '-- C2 PR jar REFUSED  Migration checksum mismatch for migration version 16',
    '--       -> Applied to database : 1110071400   -> Resolved locally : 2104958993',
    '',
    '## Recovery for a C-type schema (tested on both engines)',
    '!! UPDATE flyway_schema_history SET version=17, description, script  WHERE D4 row',
    '-- default start:  Detected resolved migration not applied to database: 16',
    '++ one start with spring.flyway.out-of-order=true: W0e V16 applied as rank #17',
    '++ later default starts OK; W0e columns present (loss/stop evidence, abandoned_at)',
  ].join('\n')),
  'A confirms the PR\'s risk claim: main could not have written D4 as V16 anywhere. B is the real-world path (W0e-only main, then the fix). V17\'s checksum equals the old D4 V16 checksum, so the SQL is byte-identical. C only exists in databases built from the D4 branch before it merged (dev/verification rigs); main deployments never reach it.'));

cards.push(card('c3', 'Upgrade E2E with a real Hosted Harness: old main leaves waiting archive/delete, PR jar finishes them',
  'Spring jar + packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) + fake model + fault proxy (503 on Harness DELETE /session) · 4 runs',
  pre([
    '## w0e -> PR on MariaDB 10.11.18 (excerpt; the other three runs read the same)',
    '== [w0e history] #16 V16 "runtime loss evidence" checksum=2104958993',
    '++ [w0e archive (Harness healthy)] 200 status=archived',
    '!! [w0e archive (Harness close 503)] 503 hosted_harness_unavailable',
    '!! [w0e delete (Harness close 503)]  503 hosted_harness_unavailable',
    '== [w0e commands] ARCHIVE_SESSION COMPLETED | ARCHIVE_SESSION PENDING | DELETE_SESSION PENDING',
    '++ [PR jar] started after 2.9s; adds #17 V17 "managed session operation" checksum=1110071400',
    '== [PR commands] ARCHIVE_SESSION COMPLETED | ARCHIVE_SESSION MIGRATED | DELETE_SESSION MIGRATED',
    '++ [PR ARCHIVE completed] 200 archive/completed stage=harness_confirmed | status=ARCHIVED | writer SEALED',
    '++ [PR DELETE completed]  200 delete/completed stage=harness_confirmed | status=DELETED | writer SEALED',
    '++ [retry migrated archive key] 202 archive/completed replayed=true same=true',
    '++ [retry migrated delete key]  202 delete/completed replayed=true same=true',
    '== [retry completed w0e archive key] 409 session_state_conflict   (documented in D4 4.10)',
    '++ [new Session close]   202 close/pending   -> 200 close/completed stage=harness_confirmed',
    '++ [new Session archive] 202 archive/completed stage=java_durable',
    '++ [new Session delete]  202 delete/pending  -> 200 delete/completed',
  ].join('\n')) + table(['Old jar', 'Engine', 'PR jar applied', 'Waiting commands', 'Migrated ops finished', 'Retries', 'New Session D4 ops'], [
    ['w0e d66fdadd27 (V16 = W0e)', 'MySQL 8.4.11', '++ V17', 'archive + delete', '++ 2/2 harness_confirmed', '++ replay same op; 409 for completed key', '++ close / archive / delete'],
    ['w0e d66fdadd27 (V16 = W0e)', 'MariaDB 10.11.18', '++ V17', 'archive + delete', '++ 2/2 harness_confirmed', '++ replay same op; 409 for completed key', '++ close / archive / delete'],
    ['pre 3124af5bcc (head V15)', 'MySQL 8.4.11', '++ V16 then V17', 'archive + delete', '++ 2/2 harness_confirmed', '++ replay same op; 409 for completed key', '++ close / archive / delete'],
    ['pre 3124af5bcc (head V15)', 'MariaDB 10.11.18', '++ V16 then V17', 'archive + delete', '++ 2/2 harness_confirmed', '++ replay same op; 409 for completed key', '++ close / archive / delete'],
  ]),
  'The waiting commands were made by the old server itself through a real Harness close outage, not inserted by SQL. The W0e-only leg (V16 &rarr; V17) is the path the PR description names; no repository test covers it today (see the next card).'));

cards.push(card('c4', 'Merge queue and one test gap',
  'git merge-tree trial merges on origin/main fc4e01b9fc · migration directory checked for duplicate versions · suite run on the #12855 merge',
  pre([
    '## main fc4e01b9fc + #12900',
    '++ clean merge · versions V1..V14, V15 (Java), V16, V17 · no duplicates',
    '## + #12855 (fa7e06f78d)',
    '++ clean merge · V16 V17 V18 unique',
    '++ managed-agent-server on MariaDB: 170 unit, ManagedAgentMySqlIT 13/13, Checkstyle 0',
    '## + #12894 (6b2bc23cba), which carries the identical V16 -> V17 rename (same blob fc9cfcf7)',
    '!! conflicts only in the two D4 design docs (4.10 renumbering paragraph, 7 Validation)',
    '++ migration rename and README merge cleanly',
    '## #12894 vs #12855, independent of this PR',
    '-- both add V18: V18__managed_tool_publication.sql vs V18__managed_extension_record.sql',
    '',
    '## Test gap: nothing pins the W0e-only (V16 -> V17) upgrade',
    '!! mutant: D4 migration renamed to V15_1 (ordered before W0e)',
    '-- ManagedSessionOperationMigrationTest today (target 15):   1/1 pass  -> mutant survives',
    '++ candidate @ValueSource(strings = {"15", "16"}):            [2] fails -> mutant killed',
    '++ candidate on the PR head: 2/2 pass, Checkstyle 0 (test-only diff, +7/-4)',
  ].join('\n')),
  'This PR merges cleanly on current main, and #12855 goes green on top of it. #12894 has to resolve two doc hunks after this lands, and #12894 and #12855 still need to agree on V18. The V16-baseline test is optional hardening; the real-stack run on the previous card already covers that path for this head.'));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;padding:24px}
.card{width:1320px;background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:22px 26px;margin-bottom:28px}
h1{font-size:21px;margin:0 0 6px;color:#f0f6fc}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px}
pre{font-family:ui-monospace,Menlo,monospace;font-size:13.2px;line-height:1.5;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:12px 14px;white-space:pre;overflow:hidden;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:13.2px;margin:6px 0}
th{background:#161b22;color:#8b949e;text-align:left;font-weight:600;padding:7px 9px;border:1px solid #30363d}
td{padding:6px 9px;border:1px solid #30363d;vertical-align:top}
.h{color:#79c0ff;font-weight:600}.ok{color:#56d364}.bad{color:#f85149}.warn{color:#e3b341}.dim{color:#8b949e}
.note{border-left:3px solid #388bfd;padding:6px 12px;color:#c9d1d9;font-size:13.5px;line-height:1.5;background:#0f1a2a}
code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#e3b341}
</style></head><body>${cards.join('\n')}</body></html>`;
fs.writeFileSync(path.join(FIG, 'cards.html'), html);

const names = { c1: '01-ci-replica-ab', c2: '02-which-db-starts', c3: '03-upgrade-e2e-real-harness', c4: '04-merge-queue-and-test-gap' };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(FIG, 'cards.html'));
const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).map((p) => p.closest('section').id));
console.log('clipped pre blocks:', JSON.stringify(clipped));
for (const [id, name] of Object.entries(names)) {
  await page.locator('#' + id).screenshot({ path: path.join(FIG, `${name}.png`) });
  console.log('wrote', name);
}
await browser.close();
