// VERIFICATION RIG ONLY: render the evidence cards for PR 13099 from the
// recorded results (mutation matrix + real-stack scenario JSON).
// usage: node figures.mjs <outDir> <scenarioDir> <coordResults> <fullResults>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MUTATIONS } from '../mut/mutate.mjs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad';
const [outDir, scenDir, coordFile, fullFile] = process.argv.slice(2);
const require = createRequire(`${SP}/wt-merge/package.json`);
const { chromium } = require('playwright');

const HEAD = '697d38a33e';
const MAIN = '3a8fd11711';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const load = (n) => JSON.parse(fs.readFileSync(`${scenDir}/${n}.json`, 'utf8'));
const results = (file) =>
  fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l.replace(/^RESULT /, '')));
const short = (n) =>
  n.replace(/\(boolean, boolean, int, boolean\)/, '').replace(/\((boolean|int)\)/, '');

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; font: 15px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #e6edf3; }
  #card { width: 1240px; padding: 28px 32px 26px; background: #0d1117; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 650; }
  .sub { color: #8b949e; font-size: 14px; margin: 0 0 18px; }
  h2 { font-size: 15px; margin: 20px 0 8px; color: #79c0ff; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th { text-align: left; color: #8b949e; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid #30363d; white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid #21262d; vertical-align: top; }
  code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  pre { margin: 0; padding: 12px 14px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; }
  .ok { color: #3fb950; font-weight: 600; } .bad { color: #f85149; font-weight: 600; }
  .warn { color: #d29922; font-weight: 600; } .dim { color: #8b949e; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .p-ok { background: #12361f; color: #3fb950; } .p-bad { background: #3d1518; color: #ff7b72; }
  .p-warn { background: #3a2c0a; color: #e3b341; } .p-dim { background: #21262d; color: #8b949e; }
  .note { margin-top: 16px; padding: 10px 14px; border-left: 3px solid #1f6feb; background: #121d2f; font-size: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .box { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 14px; }
  .box h3 { margin: 0 0 8px; font-size: 14px; color: #e6edf3; }
  .kv { display: grid; grid-template-columns: 190px 1fr; row-gap: 3px; font-size: 13.5px; }
  .kv div:nth-child(odd) { color: #8b949e; }
`;

const page = (title, sub, body, note) => `<!doctype html><meta charset="utf-8"><style>${css}</style>
<div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${note ? `<div class="note">${note}</div>` : ''}</div>`;

const kv = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>`;
const pill = (cls, text) => `<span class="pill p-${cls}">${esc(text)}</span>`;
const path = (frames) => frames.map((f, i) => `${i ? '  <- ' : ''}${esc(f)}`).join('\n');
const status = (t) =>
  `${pill(t.status === 'COMPLETED' ? 'ok' : t.status === 'FAILED' ? 'bad' : 'warn', t.status)}${t.error_code ? ` <code>${esc(t.error_code)}</code>` : ''}`;

// ---------------------------------------------------------------- card 1
function matrixCard() {
  const rows = results(coordFile);
  const full = results(fullFile);
  const at = (v, m) => rows.find((r) => r.variant === v && r.mutation === m);
  const claim = { M1: 'PR test plan', M2: 'PR test plan', M3: 'PR test plan', M4: 'PR test comment', M7: 'PR test plan', M8: 'PR test plan' };
  const cell = (r) =>
    r.state === 'GREEN'
      ? `${pill('warn', 'survives')} <span class="dim">${r.tests}/${r.tests}</span>`
      : `${pill('ok', 'killed')} <span class="dim">${r.failures} of ${r.tests} fail</span>`;
  const body = `
  <table><tr><th>#</th><th>single-site mutation of <code>HarnessCoordinator.java</code></th><th>tests on main</th><th>tests at PR head</th><th>failing tests at PR head</th></tr>
  ${Object.keys(MUTATIONS).filter((m) => m !== 'M0').map((m) => {
    const b = at('base2', m); const p = at('pr2', m);
    return `<tr><td class="mono">${m}</td><td>${esc(MUTATIONS[m].note.replace(/^author #\d: /, ''))}${claim[m] ? ` <span class="dim">(${claim[m]})</span>` : ''}</td><td style="white-space:nowrap">${cell(b)}</td><td style="white-space:nowrap">${cell(p)}</td><td class="mono">${p.failed.map((f) => esc(short(f))).join('<br>') || '<span class="dim">none</span>'}</td></tr>`;
  }).join('')}
  </table>
  <h2>Intact production code</h2>
  ${kv([
    ['HarnessCoordinatorTest', `<span class="ok">${at('pr2', 'M0').tests} run, 0 failed</span> at PR head &nbsp;<span class="dim">(${at('base2', 'M0').tests} on main)</span>`],
    ['managed-agent-server unit suite', `<span class="ok">${full[0].tests} run, ${full[0].failures + full[0].errors} failed</span> <span class="dim">(mvn test, JDK 21, merge tree)</span>`],
  ])}`;
  const killed = (v) => Object.keys(MUTATIONS).filter((m) => m !== 'M0' && at(v, m).state === 'RED').length;
  return page(
    'Mutation matrix: what the coordinator tests can detect',
    `PR #13099 @ ${HEAD} merged into main @ ${MAIN} &middot; each cell is one <code>mvn -Dtest=HarnessCoordinatorTest test</code> run against one mutant`,
    body,
    `Every mutation named in the PR description fails exactly the tests it names. Kill rate ${killed('base2')}/9 on main &rarr; ${killed('pr2')}/9 at PR head: M3, M7 and M8 (the three <code>DaemonHttpException</code> cells) had no witness before this PR.`,
  );
}

// ---------------------------------------------------------------- card 2
function authorizationCard() {
  const r1 = load('r1'); const r2 = load('r2');
  const coord = (j) => j.thrown.find((e) => e.frames.some((f) => f.startsWith('HarnessCoordinator.runClaimed')));
  const body = `<div class="grid">
   <div class="box"><h3>R1 &middot; refused on the first dispatch (retry 0)</h3>${kv([
     ['setup', 'Workspace drained in the statement that commits the Turn'],
     ['Turn', status(r1.turn)],
     ['retry_count', `<b>${r1.turn.retry_count}</b>`],
     ['settled after', `${r1.turn.settledMs} ms`],
     ['Harness requests', `${r1.harnessCalls.length}`],
     ['coordinator retries', `${r1.retryLog.length}`],
     ['public event', `<code>${esc(r1.terminal[0].type)} {code: ${esc(r1.terminal[0].data.code)}}</code>`],
   ])}</div>
   <div class="box"><h3>R2 &middot; refused with the retry budget spent (retry 5)</h3>${kv([
     ['setup', `Harness unreachable for ${(r2.budgetSpentAfterMs / 1000).toFixed(1)} s (5 retries), then drained`],
     ['Turn', status(r2.turn)],
     ['retry_count', `<b>${r2.turn.retry_count}</b>`],
     ['not', '<code>hosted_harness_unavailable</code> (the exhaustion code)'],
     ['earlier retries', `${r2.retryLog.length} &times; <code>MutationOutcomeUnknownException</code>`],
     ['public event', `<code>${esc(r2.terminal[0].type)} {code: ${esc(r2.terminal[0].data.code)}}</code>`],
   ])}</div></div>
  <h2>Where the exception was constructed (JDK Flight Recorder, running Spring JVM)</h2>
  <pre>RuntimeBrokerException: ${esc(coord(r1).message)}
${path(coord(r1).frames)}</pre>`;
  return page(
    'Real stack: Workspace authorization refused before submission',
    `Spring Boot managed-agent-server + MySQL 8.4 + packaged Hosted Harness + Runtime Broker &middot; main @ ${MAIN} + PR @ ${HEAD}`,
    body,
    'Matches <code>failsOnWorkspaceAuthorizationRefusalBeforeSubmission[0, 5]</code>: the producer is <code>WorkspaceExecutionStore.unavailable()</code> raised by <code>authorize</code> inside <code>createOrLoad</code>, and the Turn ends as <code>workspace_unavailable</code> at both retry counts.',
  );
}

// ---------------------------------------------------------------- card 3
function recordedCard() {
  // The rerun also recorded the refusal call paths.
  const r3 = load(fs.existsSync(`${scenDir}/r3b.json`) ? 'r3b' : 'r3');
  const fails = r3.retryLog.map((l) => l.match(/retry=(\d+) delayMs=(\d+) failure=(\w+)/));
  const rows = r3.timelineWhileRefused.map((t) => {
    const f = fails.find((m) => Number(m[1]) === t.retry_count);
    return `<tr><td class="mono">+${t.tSec.toFixed(1)} s</td><td>${pill('warn', t.status)}</td><td class="mono">${t.retry_count}${t.retry_count > 5 ? ' <span class="dim">(budget is 5)</span>' : ''}</td><td class="mono">${f ? esc(f[3]) : ''}</td><td class="mono">${f ? `${f[2]} ms` : ''}</td></tr>`;
  }).join('');
  const coord = r3.thrownByPath?.find((p) => p.frames.some((f) => f.startsWith('HarnessCoordinator.runClaimed')));
  const body = `
  ${kv([
    ['before', `${status(r3.beforeRefusal)} &nbsp;submission recorded, admitted, first tool call done, model still answering`],
    ['then', 'Workspace set to DRAINING and the event stream severed'],
  ])}
  <h2>While authorization keeps refusing</h2>
  <table><tr><th>since refusal</th><th>Turn</th><th>retry_count</th><th>failure handled by the coordinator</th><th>next delay</th></tr>${rows}</table>
  ${coord ? `<h2>Call path of the refusal (${coord.count} &times;)</h2><pre>${path(coord.frames)}</pre>` : ''}
  <h2>After the Workspace is ACTIVE again</h2>
  ${kv([
    ['Turn', `${status(r3.turnAfterReactivation)} &nbsp;${(r3.turnAfterReactivation.settledMsAfterReactivation / 1000).toFixed(1)} s later, retry_count ${r3.turnAfterReactivation.retry_count}`],
    ['public event', `<code>${esc(r3.terminal[0]?.type ?? 'none')}</code>`],
  ])}`;
  return page(
    'Real stack: the same refusal after a recorded submission',
    `A Turn the Harness is still executing &middot; main @ ${MAIN} + PR @ ${HEAD}`,
    body,
    'Matches <code>retriesWorkspaceAuthorizationRefusalAfterARecordedSubmission</code> and <code>neverTerminatesOnceSubmissionMayHaveBeenAdmitted</code>: the Turn outlives the pre-admission budget, is never failed, and finishes once authority returns.',
  );
}

// ---------------------------------------------------------------- card 4
function contentionCard() {
  const r4 = load('r4');
  const busy = r4.thrownSinceContention.find((e) => /held by another/.test(e.message));
  const http = r4.thrownSinceContention.filter((e) => e.cls === 'DaemonHttpException').length;
  const body = `<div class="grid">
   <div class="box"><h3>Session A &middot; holds the Workspace lease</h3>${kv([
     ['Turn', status(r4.holder)], ['lease rows held', esc(r4.holder.leaseHeld)], ['finally', status(r4.holderFinal)],
   ])}</div>
   <div class="box"><h3>Session B &middot; same Workspace, while A holds it</h3>${kv([
     ['Turn', status(r4.contender)],
     ['retry_count', `<b>${r4.contender.retry_count}</b>`],
     ['settled after', `${r4.contender.settledMs} ms`],
     ['coordinator retries', `${r4.contenderRetryLog.length}`],
     ['DaemonHttpException thrown', `${http}`],
     ['public event', `<code>${esc(r4.contenderTerminal[0].type)} {code: ${esc(r4.contenderTerminal[0].data.code)}}</code>`],
   ])}</div></div>
  <h2>Every Spring &rarr; Harness call of Session B</h2>
  <pre>${r4.contenderHarnessCalls.map(esc).join('\n')}</pre>
  <h2>Where workspace_busy was raised and where it surfaced</h2>
  <pre>RuntimeBrokerException: ${esc(busy.message)}
${path(busy.frames)}

Harness stderr: ${esc(r4.harnessStderr.at(-1).replace(/^qwen serve: /, ''))}</pre>
  <h2>Control: Session C after A released</h2>
  ${kv([['Turn', `${status(r4.controlAfterRelease)} &nbsp;file content <code>${esc(r4.controlAfterRelease.fileC)}</code>`]])}`;
  return page(
    'Real stack: Broker lease contention (workspace_busy)',
    `Two Sessions on one Workspace storage &middot; main @ ${MAIN} + PR @ ${HEAD}`,
    body,
    'The refusal is raised in the Broker and ends Session B&rsquo;s turn inside the Harness as a <code>turn_error</code> event. No 409 crosses the Spring&ndash;Harness boundary and the coordinator retries nothing, as the corrected comment at PR head says.',
  );
}

// ---------------------------------------------------------------- card 5
function httpCard() {
  const row = (tag, what) => {
    const j = load(tag);
    const ex = j.thrown.filter((e) => e.frames.some((f) => f.startsWith('HarnessCoordinator.'))).at(-1) ?? j.thrown.at(-1);
    const wrapped = j.retryLog[0]?.match(/failure=(\w+)/)?.[1];
    const site = ex?.frames.find((f) => /^HostedHarnessClient\./.test(f)) ?? '';
    return `<tr><td class="mono">R${tag.slice(1)}</td><td>${what}</td><td class="mono">${esc(wrapped ?? ex?.cls ?? '')}<br><span class="dim">${esc(site)}</span></td><td>${j.retryLog.filter((l) => /will retry/.test(l)).length}</td><td>${status(j.turn)}</td></tr>`;
  };
  const r6d = load('r6d'); const r5 = load('r5');
  const count = (calls, re) => calls.filter((c) => re.test(c)).length;
  const p6 = r6d.thrown.find((e) => /load failed with HTTP 409/.test(e.message));
  const body = `
  <h2>Statuses injected at the Spring &rarr; Harness boundary (one reply each)</h2>
  <table><tr><th></th><th>Harness reply</th><th>what reached the coordinator</th><th>retries</th><th>Turn</th></tr>
   ${row('r6a', '<code>POST /prompt</code> &rarr; 400')}
   ${row('r6c', '<code>POST /prompt</code> &rarr; 409 <code>hosted_turn_active</code>')}
   ${row('r6b', '<code>GET /events</code> &rarr; 503')}
   ${row('r6e', '<code>POST /prompt</code> &rarr; 503')}
  </table>
  <h2>409s that occurred with no status injected</h2>
  <div class="grid">
   <div class="box"><h3>R6d &middot; the reply to a successful create is lost</h3>${kv([
     ['Harness answers', `${count(r6d.harnessCalls, /\/load -> 409 hosted_session_already_attached/)} &times; <code>load &rarr; 409 hosted_session_already_attached</code>`],
     ['coordinator retries', `${r6d.retryLog.filter((l) => /will retry/.test(l)).length}, then exhausted`],
     ['Turn', `${status(r6d.turn)} after ${(r6d.turn.settledMs / 1000).toFixed(1)} s`],
   ])}</div>
   <div class="box"><h3>R5 &middot; Spring SIGKILLed and restarted mid-Turn</h3>${kv([
     ['Harness answers', `${count(r5.harnessCallsAfterRestart, /\/load -> 409 hosted_session_already_attached/)} &times; <code>load &rarr; 409 hosted_session_already_attached</code>`],
     ['coordinator retries', `${r5.retryLog.length} in ${r5.observedSecAfterRestart} s (submission recorded: no budget)`],
     ['Turn', `${status(r5.turn)} still, retry_count ${r5.turn.retry_count}`],
   ])}</div></div>
  <h2>The 409 that escapes createOrLoad (R6d shown; R5 takes the same path without the <code>create</code> frame)</h2>
  <pre>DaemonHttpException: ${esc(p6.message)}
${path(p6.frames.filter((f) => !f.includes('lambda')))}</pre>`;
  return page(
    'Real stack: the DaemonHttpException arm',
    `Which Harness HTTP errors reach the coordinator, and what it does with them &middot; main @ ${MAIN} + PR @ ${HEAD}`,
    body,
    'The three new cells behave as pinned (400 ends the Turn as <code>hosted_harness_rejected</code>; 409 and 503 are retried). The 409 that really escapes <code>createOrLoad</code> comes from the load path as <code>hosted_session_already_attached</code>; a 5xx on a mutation arrives as <code>PromptAdmissionUnknownException</code>, not <code>DaemonHttpException</code>.',
  );
}

const cards = {
  '01-mutation-matrix': matrixCard,
  '02-authorization-refusal': authorizationCard,
  '03-recorded-submission': recordedCard,
  '04-lease-contention': contentionCard,
  '05-http-error-arm': httpCard,
};
const only = process.env.ONLY?.split(',');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1300, height: 900 } });
for (const [name, build] of Object.entries(cards)) {
  if (only && !only.includes(name.slice(0, 2))) continue;
  const html = build();
  fs.writeFileSync(`${outDir}/${name}.html`, html);
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre, td, .kv div')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name}.png written (clipped elements: ${clipped})`);
  await p.close();
}
await browser.close();
