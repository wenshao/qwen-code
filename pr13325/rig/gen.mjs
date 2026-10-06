// Evidence cards for PR #13325 -> fig/*.png (Playwright, element screenshots).
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/Users/wenshao/pr13325-rig/src-head/package.json');
const { chromium } = require('playwright');
const DIR = '/Users/wenshao/pr13325-rig/fig';
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1200px;max-width:1700px}
h1{font-size:24px;margin:0 0 4px 0;color:#f0f6fc}
.sub{color:#8b949e;font-size:14px;margin-bottom:16px}
table{border-collapse:collapse;font-size:14px;margin:6px 0 14px 0;width:100%}
th{background:#161b22;color:#8b949e;text-align:left;padding:7px 10px;border:1px solid #30363d;font-weight:600}
td{padding:6px 10px;border:1px solid #30363d;vertical-align:top;font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre}
td.t{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;white-space:normal}
.bad{color:#ff7b72}.good{color:#7ee787}.warn{color:#e3b341}.dim{color:#8b949e}
pre{background:#161b22;border:1px solid #30363d;padding:10px 12px;font-size:13px;line-height:1.45;margin:6px 0 14px 0;white-space:pre;overflow:hidden}
.note{border-left:4px solid #388bfd;padding:6px 12px;color:#c9d1d9;font-size:14px;margin-top:6px;background:#0d1117}
.note.w{border-color:#e3b341}
h2{font-size:16px;margin:14px 0 4px 0;color:#79c0ff}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table>`;
const B = (s) => `<span class="bad">${esc(s)}</span>`;
const G = (s) => `<span class="good">${esc(s)}</span>`;
const W = (s) => `<span class="warn">${esc(s)}</span>`;
const D = (s) => `<span class="dim">${esc(s)}</span>`;

const cards = {};

cards['01-lock-order'] = page(
  'Lock order: public cancel vs Harness admission (real stack, real InnoDB)',
  'Spring fat jar + packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) + fake model; proxy holds the POST /session/:id/prompt response. base = 43a6e1e5 (merge-base, = main for sdk-java), head = 58f8b173.',
  `<pre>1. holder connection: BEGIN; SELECT … FROM managed_agent_session WHERE (tenant_id, session_id) = … FOR UPDATE
2. public cancel  POST /v1/agents/sessions/{id}/events {"type":"agent.session.cancel"}   -> queues on the Session row  (LOCK WAIT +1)
3. release the held /prompt response -> HarnessCoordinator calls store.recordAdmission  -> queues                       (LOCK WAIT +1)
4. holder COMMIT</pre>` +
    table(['arm', 'database', 'deadlocks', 'dispatcher retries', 'final Turn', 'cancel HTTP', 'cancel -> settled'], [
      row([B('base'), 'MySQL 8.4.7', B('5 / 5'), B('5 / 5  CannotAcquireLockException'), 'CANCELLED', '202', '3.4 – 3.9 s']),
      row([B('base'), 'MariaDB 10.11.18', B('5 / 5'), B('5 / 5  CannotAcquireLockException'), 'CANCELLED', '202', '3.2 – 4.0 s']),
      row([G('head'), 'MySQL 8.4.7', G('0 / 5'), G('0'), 'CANCELLED', '202', '2.06 – 2.10 s']),
      row([G('head'), 'MariaDB 10.11.18', G('0 / 5'), G('0'), 'CANCELLED', '202', '2.10 – 2.13 s']),
      row([W('M02 = head with the lock moved after the Turn UPDATE'), 'MySQL 8.4.7', B('5 / 5'), B('5 / 5'), 'CANCELLED', '202', '3.4 – 3.9 s']),
    ]) +
    `<h2>innodb_trx LOCK WAIT queue right after step 3</h2><pre><span class="bad">base</span>  UPDATE managed_agent_session SET harness_event_epoch = …     <span class="dim">&lt;- recordAdmission, already holding the Turn row</span>
      SELECT * FROM managed_agent_session … FOR UPDATE              <span class="dim">&lt;- cancel (insertCancelCommand) and the environment event append</span>
      SELECT * FROM managed_agent_session … FOR UPDATE
<span class="good">head</span>  SELECT * FROM managed_agent_session … FOR UPDATE   ×2–3       <span class="dim">&lt;- recordAdmission now queues on the Session row before touching the Turn row</span></pre>` +
    `<div class="note">Every base run deadlocked on both engines; head never did. In all 15 base/M02 deadlocks InnoDB rolled back the dispatcher's admission (the Turn then retried after 1 s and still ended CANCELLED), so the cancel request answered 202 each time. The HTTP 500 variant described in the PR body did not occur in this interleaving.</div>` +
    `<div class="note w">M02 (requireSessionForUpdate moved below the Turn UPDATE in recordAdmission) brings the deadlock back 5/5, yet SessionRowLockOrderTest stays green: its "turn-row access" needles are helper calls only, and recordAdmission touches the Turn row through raw SQL.</div>`,
);

cards['02-api-matrix'] = page(
  'Same requests against both jars (MySQL 8.4.7; recovery code also on MariaDB 10.11.18)',
  'Public API /v1/agents/sessions, WebShell /api/agent/web-shell/v1, internal Session Store recovery:block. tr_TR rows: JVM started with -Duser.language=tr -Duser.country=TR.',
  table(['request', 'base 43a6e1e5', 'head 58f8b173'], [
    row(['PUT / DELETE /v1/agents/sessions', B('500 internal_error (ERROR stack logged)'), G('405 method_not_allowed, Allow: GET, POST')]),
    row(['POST create, text/plain body, Idempotency-Key set', B('500 internal_error'), G('415 unsupported_media_type')]),
    row(['GET /v1/agents/sessions?limit=abc', W('400 "The request body is invalid."'), G(`400 "Request parameter 'limit' has an invalid value."`)]),
    row(['GET …/restore without workspaceId', W('400 "The request body is invalid."'), G(`400 "Request parameter 'workspaceId' is required."`)]),
    row(['recovery:block, detail code 129 / 4096 chars', B('500 internal_error (Data truncation); journal head stays READY'), G('400 invalid_request; journal head stays READY')]),
    row(['recovery:block, 128 ASCII / 128 CJK / 64 emoji', '200, BLOCKED_EXECUTION recorded', '200, BLOCKED_EXECUTION recorded']),
    row(['recovery:block, 65 emoji (130 UTF-16 units, 65 chars)', '200, recorded', W('400 (cap counts UTF-16 units, column counts chars)')]),
    row(['tr_TR: session status (create/get/list/WebShell)', B('"actıve"'), G('"active"')]),
    row(['tr_TR: Turn status while running', B('"runnıng"'), G('"running"')]),
    row(['tr_TR: status after close + archive', B('"archıved"'), G('"archived"')]),
    row(['tr_TR: archive while active (409 message)', B('"The Session is actıve and cannot …"'), G('"The Session is active and cannot …"')]),
    row(['Harness disabled: replay a recorded submit', B('503 hosted_harness_disabled'), G('202 replayed: true')]),
    row(['Harness disabled: replay a recorded create+input', B('503 hosted_harness_disabled'), G('202 X-Qwen-Idempotent-Replay: true')]),
    row(['Harness disabled: fresh submit / fresh create+input', '503 / 503', '503 / 503']),
    row(['Harness disabled: rows written by the replays', '0', '0']),
    row(['rename, delete, replay the rename', B('404 session_not_found'), G('200 replay=true, status "active" (pre-delete)')]),
    row(['close+archive+unarchive, delete, replay the unarchive', B('404 session_not_found'), G('200 replay=true, status "closed"')]),
    row(['same key, different title, after delete', '409 idempotency_conflict', '409 idempotency_conflict']),
    row(['paging limit=2: page 1 [C,B]; rename A; page 2', B('[]   (A never listed)'), G('[A]')]),
    row(['paging limit=2: page 1 [C,B]; Turn on A; page 2', B('[]   (A never listed)'), G('[A]')]),
    row(['create title 257 – 512 chars (public and WebShell)', '202', W('400 invalid_title (OpenAPI WebShell title: maxLength 512)')]),
    row(['create title with a TAB', B('202, stored "bad\\ttitle"'), G('400 invalid_title')]),
    row(['rename title 257 / 300 chars', '400 invalid_request', '400 invalid_title']),
  ]),
);

cards['03-migration'] = page(
  'V47 on a populated database: upgrade, plan, cursor carry-over, rollback',
  'One database per engine: base jar creates V46 data (6 sessions + 3000 in one tenant + a Turn) -> head jar (Flyway applies V47) -> base jar again. List SQL captured from general_log, then EXPLAIN / EXPLAIN ANALYZE.',
  table(['step', 'MySQL 8.4.7', 'MariaDB 10.11.18'], [
    row(['base jar, fresh DB', 'V46; managed_agent_session_list_idx(tenant_id, updated_at, session_id)', 'same']),
    row(['base list (3000 rows in tenant)', 'Index lookup on list_idx (reverse), 21 rows, 0.085 ms', 'ref list_idx, Using where (no filesort)']),
    row(['head jar, same DB', G('"Migrating schema … to version 47" — applied, boot 4.5 s'), G('applied, boot 4.2 s')]),
    row(['indexes after V47', G('managed_agent_session_created_idx(tenant_id, created_at, session_id); list_idx dropped'), G('same')]),
    row(['head list', G('Index lookup on created_idx (reverse), 21 rows, 0.10 ms'), G('ref created_idx, Using where (no filesort)')]),
    row(['Turn on a pre-upgrade Session (head)', 'COMPLETED', 'COMPLETED']),
    row(['base-minted cursor (updated_at of U5) used on head', W('page 2 = [U4, U3]; fresh walk [U5,U4] [U3,U2] -> U0 repeats later, nothing lost'), W('same')]),
    row(['roll back to base jar on the V47 schema', 'boots ("Successfully validated 47 migrations"), list 200', 'boots, list 200']),
    row(['base list after rollback', W('Sort: updated_at DESC … (filesort over the tenant), 4.78 ms'), W('ref PRIMARY, Using where; Using filesort')]),
  ]) + `<div class="note">The migration applies cleanly on both engines, the new index serves the created_at keyset without a sort, and a rollback keeps working (only the old updated_at listing loses its index). V47 is also claimed by open PRs #13497, #13219 and #13260; whichever lands later has to renumber.</div>`,
);

cards['04-mutation'] = page(
  'Do the PR\'s witness tests pin the fixes? 16 single-site mutants on head',
  'Each mutant applied alone to a clean head worktree; only the witness tests named for it are run (mvn -o test -Dtest=…, JDK 21, H2). Baseline: 20/20 pass.',
  table(['mutant', 'witness', 'result'], [
    row(['M01 recordAdmission: drop requireSessionForUpdate', 'SessionRowLockOrderTest', G('killed')]),
    row(['M02 recordAdmission: move the lock below the Turn UPDATE', 'SessionRowLockOrderTest', B('SURVIVED  (real stack: 5/5 deadlocks)')]),
    row(['M03 failTurn: drop requireSessionForUpdate', 'SessionRowLockOrderTest', G('killed')]),
    row(['M04 listSessions back to the updated_at keyset', 'keepsPagingSessionsAcrossRowsWhoseUpdatedAtMoved', G('killed')]),
    row(['M05 recoveryDetailCode @Size(max = 4096)', 'rejectsAnOverlongRecoveryDetailCodeBeforeTheColumnDoes', G('killed')]),
    row(['M06 405 handler annotation removed', 'mapsMethodAndMediaTypeErrorsThroughTheAdviceDispatch', G('killed')]),
    row(['M07 415 handler annotation removed', 'ApiExceptionHandlerTest + mapsMethodAndMediaType…', B('SURVIVED  (real stack: text/plain -> 500)')]),
    row(['M08 / M09 session / Turn status default-locale fold', 'foldsSession… / foldsTurnStatuses…', G('killed / killed')]),
    row(['M10 tool status default-locale fold', 'ManagedAgentStoreLocaleTest', G('killed')]),
    row(['M11 / M12 harness gate back above the replay (submit / create)', 'replaysASubmittedTurn… / replaysACreation…', G('killed / killed')]),
    row(['M13 rename pre-delete replay probe disabled', 'aBoundRenameReplays… (workspace)', G('killed')]),
    row(['M14 / M15 title cap 512 / control-char rule off', 'enforcesOneTitlePolicyAcrossCreateAndRename', G('killed / killed')]),
    row(['M16 replay serializes the DELETED row as-is', 'replaysACompletedRename… / …Unarchive… / aBoundRename…', G('killed')]),
  ]) +
    `<h2>Candidate test patch (46 lines, two test files, no production change)</h2><pre>SessionRowLockOrderTest: count "managed_agent_turn" SQL text as Turn-row access
mapsMethodAndMediaTypeErrorsThroughTheAdviceDispatch: send Idempotency-Key, expect 415 unsupported_media_type
  head + patch : 2/2 pass        M02 + patch : SessionRowLockOrderTest fails        M07 + patch : "Status expected:&lt;415&gt; but was:&lt;500&gt;"</pre>` +
    `<div class="note w">M07 is the open R2-14 thread: the IT's comment says Spring "never raises HttpMediaTypeNotSupportedException" on these routes, but the real jar raises it as soon as the required header is present (base 500, head 415).</div>`,
);

for (const [k, html] of Object.entries(cards)) fs.writeFileSync(`${DIR}/${k}.html`, html);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
for (const k of Object.keys(cards)) {
  await pg.goto(`file://${DIR}/${k}.html`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre,td,table')].concat([...document.querySelectorAll('table')].filter((t) => t.getBoundingClientRect().right > document.querySelector('#card').getBoundingClientRect().right)).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)));
  if (clipped.length) console.log(k, 'CLIPPED', clipped);
  await pg.locator('#card').screenshot({ path: `${DIR}/${k}.png` });
  console.log('wrote', k);
}
await browser.close();
