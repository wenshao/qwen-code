// VERIFICATION RIG ONLY (PR #13163): lays the measured results and the raw page screenshots out as evidence figures.
// Every number comes from the probe ledgers under out/<db>/; image regions are unmodified crops of fig/raw/*.png.
// usage: node figures13163.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13163-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });
const W = 1080;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W + 56}px;padding:22px 28px 24px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  h2{font-size:14.5px;margin:16px 0 8px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:6px;table-layout:fixed}
  td,th{overflow-wrap:anywhere}
  tr > :first-child{width:26%}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.amb{color:#d29922;font-weight:600}.dim{color:#8b949e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1f2630;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22;width:${W - 22}px}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}
  .shots{display:flex;gap:16px}
  .shot{flex:1}
  .label{font-size:13px;font-weight:600;padding:6px 10px;border-radius:6px 6px 0 0;display:inline-block}
  .label.g{background:#173a25;color:#8fe3a8}.label.r{background:#3d1f22;color:#ffb3ad}
  .strip{background-repeat:no-repeat;background-color:#fff;border:1px solid #30363d}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const t = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${/^\s*<span class="(ok|bad|amb|dim)">/.test(c) || /^[0-9+]/.test(c) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const ok = (s) => `<span class="ok">${s}</span>`;
const bad = (s) => `<span class="bad">${s}</span>`;
const amb = (s) => `<span class="amb">${s}</span>`;
const dim = (s) => `<span class="dim">${s}</span>`;

const figs = {};
figs['01-cancel-under-refusal'] = page(
  'Creator cancels a running later Turn while Workspace authorization is refused',
  'Real stack: Spring (server jar) + embedded Runtime Broker + packaged Hosted Harness (<code>dist/cli.js</code>) + MySQL 8.4.7. The later Turn is held in its model call (30 s), then asks for <code>write_file</code>. The refusal is applied after the model call starts, then the creator (alice) cancels. Same probe on both arms.',
  t(['Condition at cancel time', '#13112 head <code>b9b4da46</code>', 'this PR <code>c3925ffc</code> (cancel path unchanged through <code>9c0bcf41</code>; revoke / DRAINING / re-registration / reader re-run there: same)'], [
    ['<b>real model qwen3.8-max</b> writing step-01…step-12 one per call; revoke + cancel after step-02, grant back 1 s later', `${bad('409')} → run 1: Turn ${bad('COMPLETED')} at 28.8 s, files ${bad('2 → 12')}, 10 tool calls after the cancel; run 2: tool call raced the revoke → Turn ${amb('stuck RUNNING')} (see figure 5)`, `${ok('202')} in 9 ms → ${ok('CANCELLED')} at 1.0 s, files ${ok('2 → 2')}, 0 tool calls after the cancel (2/2 runs)`],
    ['<code>can_create</code> revoked, restored 1 s after the cancel', `${bad('409')} workspace_unavailable → Turn ${bad('COMPLETED')} at 33.5 s, file ${bad('written-after-cancel')}`, `${ok('202')} in 6 ms → model aborted at 60 ms → ${ok('CANCELLED')}, no file`],
    ['Workspace <code>DRAINING</code>, restored 1 s after the cancel', `${bad('409')} → Turn ${bad('COMPLETED')} at 32.8 s, file ${bad('written')}`, `${ok('202')} in 49 ms → aborted at 198 ms → ${ok('CANCELLED')}, no file`],
    ['<code>can_create</code> revoked until the Turn ends', `${bad('409')} → model runs the full 30 s → write refused → ${amb('FAILED')} hosted_turn_failed`, `${ok('202')} in 5 ms → ${ok('CANCELLED')} at 263 ms, no file`],
    ['<code>DRAINING</code> until the Turn ends', dim('—'), `${ok('202')} in 5 ms → ${ok('CANCELLED')} at 259 ms, no file`],
    ['re-registered (generation + 1)', `${ok('202')} → ${ok('CANCELLED')} (<code>workspaceTurns</code> still true)`, `${ok('202')} in 5 ms → ${ok('CANCELLED')} at 259 ms (<code>workspaceTurns</code>=false)`],
    ['storage id changed', dim('—'), `${ok('202')} in 6 ms → ${ok('CANCELLED')} at 259 ms, no file`],
    ['no refusal (control)', `${ok('202')} → ${ok('CANCELLED')} at 526 ms`, `${ok('202')} → ${ok('CANCELLED')} at 243 ms`],
    ['creator lost <code>can_read</code> too', dim('—'), `${ok('404')} session_not_found (by design) → Turn FAILED at the refused write`],
    ['reader bob / other creator carol cancel', dim('—'), `${ok('409')} / ${ok('409')} → Turn COMPLETED, file written (refusal kept)`],
    ['no-access mallory cancels', dim('—'), `${ok('404')} → Turn COMPLETED (refusal kept)`],
    ['Turn waits on a pending approval Action; revoke / DRAINING', dim('—'), `${ok('202')} → ${ok('CANCELLED')} at 0.5 s; Action row <code>cancelled</code>, answering it → 409 action_cancelled; no file`],
  ]) +
    `<div class="note ok">After every run in this table the next later Turn (authorization restored) was admitted and COMPLETED (17/17 fake-model runs on both arms, plus 2/2 approval runs), so cancelling under refusal does not wedge the Session or its Workspace lease. The last row answers the bot's open question about <code>if (approvals) continue;</code> in the IT: no Action row is left open.</div>`,
);

figs['02-delivery'] = page(
  'Lost and cross-owner cancel deliveries are re-sent on lease renewal',
  'Tap between Spring and the Harness drops <code>POST /session/:id/cancel</code>. Cross-owner: two Spring JVMs on one database, Turn owned by Spring A, cancel posted to Spring B (B started with the scanner idle so it never claims). Model held 60–90 s. Times are ms after the cancel was admitted.',
  t(['Scenario', 'main <code>b3dda468</code>', 'this PR <code>c3925ffc</code> (cancel path unchanged in <code>9c0bcf41</code>)'], [
    ['unbound, first delivery dropped', `1 attempt (dropped) and ${bad('never re-sent')}; Turn ran the full 60 s`, `attempts at 7 (dropped), ${ok('19 606')} → CANCELLED at 19.8 s`],
    ['bound, first delivery dropped', dim('— (no bound later Turns on main)'), `attempts at 13 (dropped), ${ok('19 505')} → CANCELLED at 19.6 s, no file`],
    ['bound, three deliveries dropped', dim('—'), `9, 19 506, 39 504 (dropped), ${ok('59 507')} → CANCELLED at 59.8 s, no file`],
    ['bound, Harness answers 503 twice', dim('—'), `two 503, then ${ok('204')} on the next renewal → CANCELLED, no file`],
    ['bound, reply lost after the Harness applied it', dim('—'), `1 attempt; Harness had cancelled → ${ok('CANCELLED')} at 242 ms (no re-send needed)`],
    ['unbound, cancel admitted by Spring B', `B answers 202, then ${bad('0 deliveries')}; Turn ran the full 60 s`, `B sends nothing; A delivers at ${ok('19 484')} → CANCELLED at 19.7 s`],
    ['bound + <code>can_create</code> revoked, cancel admitted by Spring B', dim('—'), `A delivers at ${ok('19 569')} → CANCELLED at 19.7 s, no file`],
    ['same, and A\'s first delivery dropped', dim('—'), `19 578 (dropped), ${ok('39 594')} → CANCELLED at 39.9 s, no file`],
  ]) +
    `<div class="note">Each lost or cross-owner delivery waits for the owner's next renewal (default 20 s). The Turn keeps running in that window; the probe holds the model, so no tool ran, but a tool call issued in that window would still execute. The PR discloses this cadence; #13112's current head carries the same re-send (ported in <code>bf247307</code>).</div>`,
);

const crop = (name, y0, y1) => `<div class="strip" style="width:${W / 2 - 8}px;height:${Math.round((y1 - y0) * ((W / 2 - 8) / 1810))}px;background-image:url('file://${RAW}/${name}.png');background-size:${Math.round(2360 * ((W / 2 - 8) / 1810))}px auto;background-position:-${Math.round(526 * ((W / 2 - 8) / 1810))}px -${Math.round(y0 * ((W / 2 - 8) / 1810))}px"></div>`;
figs['03-webshell'] = page(
  'WebShell: the creator loses the Cancel control exactly when this PR lets them cancel',
  'Real Managed panel (vite, this PR head) on the same running bound Turn, as the creator. Left: grants intact. Right: <code>can_create</code> revoked, page reloaded. Crops of unmodified 2x screenshots.',
  `<div class="shots"><div class="shot"><div class="label g">grants intact — "Cancel turn" shown</div>${crop('ui-01-running-granted-en', 120, 330)}${crop('ui-01-running-granted-en', 1320, 1700)}</div><div class="shot"><div class="label r">can_create revoked — no Cancel, no composer</div>${crop('ui-02-running-revoked-en', 120, 345)}${crop('ui-02-running-revoked-en', 1320, 1700)}</div></div>` +
    `<div class="note">Same run, measured: Cancel buttons 1 → 0; <code>capabilities.workspaceTurns</code> true → false. The API cancel then answered 202 and the Turn ended CANCELLED, while the panel still could not offer it. The banner reads "Message execution is not available in this service yet.", the wording #13112 replaced in <code>179aa055</code>. The PR discloses that cancel under refusal is API-only.</div>`,
);

figs['04-tests-mutation-merge'] = page(
  'Server suite across the three heads seen during this run, mutation of the new code, and the merge order',
  'JDK 21, offline Maven, <code>managed-agent-server</code> default (H2) lane; Hosted IT on MySQL 8.4.7. Mutation: one replace per mutant over the PR\'s production code, full lane each, kill = new failing testcase beyond the unmutated baseline (a load-flaky <code>ToolPublicationStoreTest</code> case is ignored).',
  `<h2>Suites</h2>` +
    t(['Tree', 'Result'], [
      ['<code>c3925ffc</code>', `${bad('test compile error')} ×3 <code>PublicSession.title()</code>; CI "Runtime Broker and Managed Agent MariaDB / Java 21" red with the same error`],
      ['<code>3cd09bec</code> (compile fixed)', `${bad('448 run, 6 failed')}: <code>requireHarness()</code> ahead of the admission gate (4 tests, incl. <code>creatorCancelsWithoutTheGrantsThatAdmitNewWork:1028</code>, which stopped before its cancel assertions) + the unbound rename fixture (2 tests)`],
      ['<code>9c0bcf41</code> <code>-Pmysql-integration</code> lane', `${bad('CI MariaDB 10.11 job red')}: <code>WorkspaceSessionCloseMySqlIT…InspectTheSession:167</code> expects workspace_unavailable, gets session_not_active; same 4/5 locally on MySQL 8.4.7. #13112 changed this assertion in <code>b9b4da46</code>`],
      ['<code>9c0bcf41</code> (current head), default lane', `${ok('448 run, 0 failed')}; the reorder matches this report's earlier candidate C0 line for line; rename now checks the read grant first; the unbound fixture throws a retryable Broker error`],
      ['<code>9c0bcf41</code> HostedPublicWorkspaceIT (MySQL 8.4.7)', `${ok('2 passed')} (+1 Linux-only case skipped on macOS); same on <code>3cd09bec</code>`],
      ['#13112 head <code>b9b4da46</code>', `${ok('451 run, 0 failed')}`],
      ['WebShell vitest (changed files + generated-type drift)', `${ok('53/53 + 2/2')}`],
    ]) +
    `<h2>Mutation (16 mutants)</h2>` +
    t(['Mutant', '<code>3cd09bec</code> (+ compile fix)', '<code>9c0bcf41</code>'], [
      ['N8 cancel goes back through the submit gate (= revert the headline)', bad('survives (masked by the red test)'), ok('killed')],
      ['N7 <code>requireCanceller</code> drops the creator clause', bad('survives (masked)'), ok('killed')],
      ['N6 <code>requireCanceller</code> drops the <code>canRead</code> clause', bad('survives'), bad('survives')],
      ['N10 <code>bindingCurrent</code> ignores <code>storage_id</code> (bot R1-2)', bad('survives'), bad('survives')],
      ['N5 opt-in clause dropped (store <code>insertCancelCommand</code> still refuses)', amb('equivalent'), amb('equivalent')],
      ['N2 <code>!leaseLost.get()</code> → true (bot R1-9) / N4 boot-id guard dropped', amb('equivalent'), dim('not rerun')],
      ['N1 renewal dispatch removed, N3 cancel attaches again, N9/N11 binding clauses, N12/N13 replay order, N14/N16 rename retirement, N15 store refuses bound cancel', ok('9/9 killed'), dim('not rerun (code unchanged)')],
    ]) +
    `<h2>Merge order</h2>` +
    `<div class="note bad"><code>git merge-tree</code> of <code>9c0bcf41</code> with #13112's head <code>22a4012f</code>: <b>8 files conflict</b> (both G0 design docs, HarnessCoordinator, ManagedAgentService, ManagedWorkspaceRegistry, the OpenAPI contract, HarnessCoordinatorTest, generated managed-agent-api.ts). <code>ManagedAgentStore</code> auto-merges silently to #13112's <code>FAILED</code>-row rename retirement while the service hunk that pairs with this PR's <code>DELETE</code> conflicts. #13112 already carries the no-attach cancel and the renewal re-send (<code>bf247307</code>; HarnessCoordinator differs only in comments). Against current main <code>f5c9bf8a</code> (#13142 landed): 1 file conflicts, the OpenAPI contract.</div>`,
);

figs['05-defects'] = page(
  'Still open at 9c0bcf41: rename retry 500, submit replay before the read grant; and a Turn no cancel can end',
  'Same real stack. The tap answers the Harness rename (<code>POST /session/:id/title</code>) with a fault once; c7 replays alice\'s keys as other actors; c10 revokes <code>can_create</code> between two tool calls of a later Turn (deterministic fake-model hold).',
  `<h2>Rename after the Harness answers 4xx once, then the same key again</h2>` +
    t(['Arm', 'first rename', 'same key, fault cleared', 'fresh key'], [
      ['main <code>b3dda468</code> (unbound)', '503, row PENDING', ok('200 replay'), ok('200')],
      ['#13112 head (bound / unbound)', '503, row FAILED', ok('200 replay'), ok('200')],
      ['this PR <code>3cd09bec</code> and <code>9c0bcf41</code> (bound and unbound)', '409 session_mutation_refused, row deleted', `${bad('500 internal_error')} — DuplicateKeyException on <code>managed_agent_event (tenant_id, session_id, source_key)</code> <code>control:RENAME_SESSION:&lt;key&gt;:requested</code>`, ok('200')],
      ['<code>9c0bcf41</code> + candidate', '409, row deleted', ok('200'), ok('200')],
    ]) +
    `<div class="note">Harness 500 / dropped connection on the same call: this PR keeps the row PENDING and the same key recovers (200 replay) — only the permanent branch breaks. The PR's own <code>AgentStateStore.abandonSessionMutation</code> javadoc says "The idempotency key stays free to re-attempt the mutation."</div>` +
    `<h2>Who can replay alice's recorded submit / rename key</h2>` +
    t(['Caller', 'GET session', '#13112 head', '<code>3cd09bec</code>', '<code>9c0bcf41</code>', '<code>9c0bcf41</code> + candidate'], [
      ['mallory (no access)', '404', '404 / 404', `${amb('202 turn_id')} / ${amb('200 + title')}`, `${amb('202 turn_id')} / ${ok('404')}`, ok('404 / 404')],
      ['bob (reader), carol (other creator)', '200', '409 / 409', '202 / 200', '202 / 200', '202 / 200'],
      ['alice after <code>can_create</code> revoked', '200', '409 / 409', ok('202 / 200 (intended recovery)'), ok('202 / 200'), ok('202 / 200')],
    ]) +
    `<h2>A tool call that collides with the revocation</h2>` +
    t(['After the first write, revoke, model\'s second write hits Broker 409', '#13112 head', 'this PR'], [
      ['Harness', '"recovery blocked" at +6.1 s', '"recovery blocked" at +6.0 s (4/4 runs on a storage of its own)'],
      ['no cancel', dim('—'), `${bad('RUNNING')} after 70 s; next later Turn 409 turn_active`],
      ['cancel while still revoked', `409 → ${bad('RUNNING')} after 70 s`, `202 → ${bad('CANCELLING')} after 70 s; POST /cancel re-sent every 20 s, 204 each, ${bad('no bound')}`],
      ['restore, then cancel', `202 → ${bad('CANCELLING')} after 70 s`, `202 → ${bad('CANCELLING')} after 70 s; next Turn 409 turn_active`],
    ]) +
    `<div class="note">Inherited from the Harness (<code>hosted-harness-session.ts</code> sets <code>session.blocked</code> and never writes the Turn result); not introduced here, but it is the common shape of "revoked while the agent is working", and this PR's re-send now repeats against it forever. Closest open issue: #13054. No second file was written in any run.</div>` +
    `<h2>Candidate on <code>9c0bcf41</code> (+16 / −5, 3 files)</h2>` +
    `<div class="note ok">(1) <code>requireReadGrant</code> before the submit replay, one statement, the counterpart of the <code>requireReadableSession</code> that <code>9c0bcf41</code> added to rename; (2) skip the <code>requested</code> event if a retired command of the same key left it (the guard #13112 has); (3) the <code>WorkspaceSessionCloseMySqlIT</code> assertion from #13112's <code>b9b4da46</code>. Default lane ${ok('448/448')}; HostedPublicWorkspaceIT ${ok('2/2')}; WorkspaceSessionCloseMySqlIT ${ok('5/5')}; full CI-equivalent <code>-Pmysql-integration</code> lane (MySQL 8.4.7, TZ=UTC) ${ok('35/35 IT, 0 Checkstyle violations')}; on the stack mallory 404 / 404, rename same-key retry 200, headline cancel unchanged (202 → CANCELLED 302 ms, no file).</div>`,
);

fs.writeFileSync(`${OUT}/figs.json`, JSON.stringify(Object.keys(figs)));
const browser = await chromium.launch({ headless: true });
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForTimeout(300);
  await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
