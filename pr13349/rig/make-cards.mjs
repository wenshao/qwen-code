// Renders PR 13349 evidence cards from the rig's result files (never from
// hand-typed numbers) and screenshots each #card with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13349-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13349-head/package.json');
const { chromium } = require('playwright');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const res = (label) => JSON.parse(readFileSync(`${RIG}/runs/${label}/result.json`, 'utf8'));
const log = (label, name) => readFileSync(`${RIG}/runs/${label}/${name}`, 'utf8');
const shortLine = (l) => l.replace(/.*HarnessCoordinator\s+: /, '').replace(/tenant=\S+ session=\S+ turn=\S+ /, '').replace(/^Managed Turn coordination /, '');
const summary = readFileSync(`${RIG}/results/summary.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const count = (prefix, pred) => summary.filter((r) => r[0].startsWith(prefix) && pred(r)).length;
const total = (prefix) => summary.filter((r) => r[0].startsWith(prefix)).length;

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;width:1240px}
h1{font-size:21px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13px;margin-bottom:16px}
table{border-collapse:collapse;font-size:13px;width:100%;table-layout:fixed}
td{overflow-wrap:anywhere}
th,td{border:1px solid #30363d;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 10px;color:#c9d1d9}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}.code{color:#79c0ff}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13px}
.cols{display:flex;gap:18px}.col{flex:1;min-width:0}
h2{font-size:15px;margin:14px 0 6px}
.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.t-base{background:#3d1d00;color:#ffa657}.t-head{background:#033a16;color:#7ee787}.t-legacy{background:#21262d;color:#d2a8ff}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const hl = (s) => esc(s).replace(/(managed_session_open_failed|hosted_harness_unavailable|MutationOutcomeUnknownException|hosted_turn_recovery_required|DaemonHttpException)/g, '<span class="code">$1</span>');

const cards = {};

// ---------- Card 1: the released 0.24.7 refusal on the wire + its cause ----------
{
  const he = res('head-exhaust-1');
  const ctl = res('head-control-1');
  const first = he.loads[0];
  const diag = log('head-diag-1', 'harness-b-legacy.log').split('\n').find((l) => l.startsWith('DIAG-13349'));
  const kinds = (k) => Object.entries(k).map(([n, c]) => `${n}×${c}`).join(' ');
  const legacyStderr = log('head-exhaust-1', 'harness-b-legacy.log').split('\n').filter((l) => /open failed/i.test(l)).length;
  const body = `
<table>
<tr><th style="width:250px">Turn 1 on the current build (dist/cli.js @ 0fe9578)</th><th>Journal event kinds (decoded from qwen_managed_session_journal_tx)</th></tr>
<tr><td>Workspace-bound Session (tool profile <code>hosted-workspace-files/1</code>)</td><td class="mono">${esc(kinds(he.journalKinds))}</td></tr>
<tr><td>Private Session (control, no tool profile)</td><td class="mono">${esc(kinds(ctl.journalKinds))} <span class="dim">— no message.delta</span></td></tr>
</table>
<h2>Owners SIGKILLed → replacement Spring + <span class="tag t-legacy">released @qwen-code/qwen-code 0.24.7</span> Hosted Harness (npm tarball, unmodified)</h2>
<table>
<tr><th style="width:250px">Recording proxy between Spring and the 0.24.7 Harness</th><th>What came back</th></tr>
<tr><td>POST /session/:id/load<br><span class="dim">(workspace Session, ${he.loads.length}/${he.loads.length} answers identical)</span></td><td><pre>HTTP ${first.status}   X-Qwen-Harness-Boot-Id: ${first.bootIdHeader ? 'present (matches /capabilities)' : 'MISSING'}
${esc(first.body)}</pre></td></tr>
<tr><td>Cause inside the 0.24.7 reader<br><span class="dim">(diagnostic copy of the bundle whose catch-all also prints the cause; every other run uses the unmodified bundle)</span></td><td><pre>${esc(diag.replace(/ \|\s+at .*$/, ''))}</pre></td></tr>
<tr><td>0.24.7 Harness stderr in the unmodified runs</td><td>${legacyStderr === 0 ? '<span class="warn">nothing</span> — the released catch-all does not log the cause' : esc(legacyStderr + ' lines')}</td></tr>
<tr><td>Control: private Session (no message.delta) on the same 0.24.7 Harness</td><td>load <span class="ok">HTTP ${ctl.loads[0].status}</span>, Turn 2 <span class="ok">${esc(ctl.turn2Terminal.type)}</span>, reply <code>${esc(ctl.turn2Text)}</code> (restored Turn 1 context)</td></tr>
</table>`;
  cards['01-legacy-refusal-on-the-wire'] = page(
    'Released 0.24.7 Harness refuses a current-build journal with a coded 503',
    'Real stack: MySQL 8.4.7 · Spring managed-agent-server jar · Session Store · embedded Runtime Broker · repo fake-openai-server. macOS arm64, Node 22, JDK 21.',
    body,
    `The released refusal is <b>not</b> a bodiless 503: it is <code>503 {"error","code":"managed_session_open_failed"}</code> with the boot-id header, so the PR's classifier sees it after <code>validateGeneration</code>. The cause is the <code>message.delta</code> event kind, which only tool-profile Sessions write; the control shows the same 0.24.7 Harness opens a journal without it.`,
  );
}

// ---------- Card 2: base vs head on the pre-admission path ----------
{
  const arm = (label) => {
    const r = res(label);
    return { lines: r.springBRetryLines.map(shortLine), term: r.turn2Terminal, row: r.turnRowFinal.split('\n').pop().split('\t') };
  };
  const b = arm('base-exhaust-1');
  const h = arm('head-exhaust-1');
  const col = (tag, a) => `<h2>${tag}</h2>
<pre>${a.lines.map(hl).join('\n')}

<span class="dim"># terminal public event (GET /v1/agents/sessions/{id}/events)</span>
${hl(JSON.stringify({ type: a.term.type, terminal: a.term.terminal, data: a.term.data }))}
<span class="dim"># managed_agent_turn row</span>
status=${a.row[1]}  error_code=${hl(a.row[2])}  retry_count=${a.row[4]}  submission_attempted=${a.row[5]}</pre>`;
  const okHead = count('head-exhaust', (r) => r[8] === 'turn.failed managed_session_open_failed' && r[6] === 'managed_session_open_failed');
  const okBase = count('base-exhaust', (r) => r[8] === 'turn.failed hosted_harness_unavailable' && r[6] === 'MutationOutcomeUnknownException');
  cards['02-base-vs-head-pre-admission'] = page(
    'Same refusal, same retries — head names it, base hides it',
    `New Turn on a Session whose journal is newer than the 0.24.7 reader (rollback after Turn 1). Same 6 coded 503s on both arms; default budget max-pre-admission-retries=5. Reproduced head ${okHead}/${total('head-exhaust')}, base ${okBase}/${total('base-exhaust')}.`,
    `${col('<span class="tag t-base">base 5ddfacc9 jar</span> Spring WARN/ERROR lines (prefix "Managed Turn coordination", tenant/session/turn ids trimmed)', b)}${col('<span class="tag t-head">head 0fe9578 jar</span> same lines', h)}`,
    'Retry cadence (1/2/4/8/16 s) and the retry decision are identical; the only deltas are the <code>failure=</code> label and the recorded <code>error_code</code> — exactly what the PR claims.',
  );
}

// ---------- Card 3: in-flight takeover (the issue's exact shape) + roll-forward ----------
{
  const inf = (label) => {
    const r = res(label);
    const row = r.inflightTurnRow.split('\t');
    return { r, row, labels: [...new Set(r.springBRetryLines.map((l) => l.match(/failure=(\S+)/)[1]))], n: r.inflightLoads.length, codes: [...new Set(r.inflightLoads.map((l) => `${l.status} ${(l.body.match(/"code":"([^"]+)"/) || [])[1]}`))] };
  };
  const hi = inf('head-inflight-1'), bi = inf('base-inflight-1'), di = inf('head-inflightdirect-1');
  const rf = (label) => { const r = res(label); const row = r.turnRowFinal.split('\n').pop().split('\t'); return { r, row }; };
  const hr = rf('head-rollforward-1'), br = rf('base-rollforward-1');
  const stale = log('head-rollforward-1', 'harness-c-current.log').split('\n').find((l) => /open failed/.test(l)) ?? '';
  const infRow = (tag, x, repl) => `<tr><td>${tag}</td><td>${repl}</td><td class="mono">${x.n} × ${hl(x.codes.join(', '))}</td><td class="mono">${hl(x.labels.join(', '))}</td><td class="mono">status=${x.row[1]} retry_count=${x.row[4]} submission_attempted=${x.row[5]}<br>terminal events: ${x.r.inflightTerminalEvents.length}</td></tr>`;
  const rfRow = (tag, x) => `<tr><td>${tag}</td><td class="mono">${x.r.refusalsBeforeRollForward.length} × 503 refused → ${hl([...new Set(x.r.springBRetryLines.map((l) => l.match(/failure=(\S+)/)[1]))].join(','))}</td><td class="mono">loads after roll-forward: ${x.r.rollForwardLoads.map((l) => l.status).join(' → ')}</td><td><span class="ok">${esc(x.r.turn2Terminal.type)}</span> <code>${esc(x.r.turn2Text)}</code><br><span class="mono dim">status=${x.row[1]} retry_count=${x.row[4]}</span></td></tr>`;
  const body = `
<h2>In-flight takeover: Turn 1 held mid-stream after its first <code>message.delta</code> was journaled, both owners SIGKILLed (retry-max-delay=4s to pass the budget quickly)</h2>
<table><tr><th style="width:120px">Spring jar</th><th style="width:150px">Replacement Harness</th><th>Load answers observed</th><th style="width:230px">Retry log label</th><th style="width:280px">Turn after 8 attempts</th></tr>
${infRow('<span class="tag t-base">base</span>', bi, '0.24.7')}
${infRow('<span class="tag t-head">head</span>', hi, '0.24.7')}
${infRow('<span class="tag t-head">head</span> control', di, 'current build')}
</table>
<h2>Roll forward: new Turn refused twice by 0.24.7, then Spring + Harness replaced by the current build</h2>
<table><tr><th style="width:120px">Spring jar</th><th>Before</th><th>After</th><th>Turn 2</th></tr>
${rfRow('<span class="tag t-base">base</span>', br)}
${rfRow('<span class="tag t-head">head</span>', hr)}
</table>
<pre style="margin-top:8px">head roll-forward, first load on the current build: ${esc(stale.replace('qwen serve: ', ''))}</pre>`;
  cards['03-inflight-and-roll-forward'] = page(
    'In-flight takeover keeps retrying past the budget; roll-forward recovers',
    'submission_attempted=1 skips the pre-admission budget on both arms — the Turn stays RUNNING with no terminal event, as the issue reported. Head only changes the log label.',
    body,
    `In-flight: the PR changes nothing but the label (8/8 lines name the code on head). After roll-forward the current build answers <code>409 hosted_turn_recovery_required</code> on <b>both</b> arms — and also with no 0.24.7 phase at all (control row), so that is the macOS rig's mid-stream recovery limit (the repo runner gates its in-flight modes to Linux), not this PR. Pre-admission roll-forward completes on both arms with restored context.`,
  );
}

// ---------- Card 4: the code is a catch-all ----------
{
  const so = (label) => { const r = res(label); return { r, row: r.turnRowFinal.split('\n').pop().split('\t') }; };
  const hs = so('head-storeoutage-1'), bs = so('base-storeoutage-1'), he = so('head-exhaust-1');
  const stale = log('head-rollforward-1', 'harness-c-current.log').split('\n').find((l) => /open failed/.test(l)) ?? '';
  const row = (tag, cause, x, harness) => `<tr><td>${tag}</td><td>${cause}</td><td>${harness}</td><td class="mono">${x.r.loads.length} × ${x.r.loads[0].status} ${hl((x.r.loads[0].body.match(/"code":"([^"]+)"/) || [])[1])}</td><td class="mono">${hl(x.row[2])}</td></tr>`;
  const body = `
<table><tr><th style="width:90px">Spring jar</th><th>Actual cause</th><th style="width:150px">Harness</th><th style="width:300px">Load answers</th><th style="width:240px">Recorded error_code</th></tr>
${row('<span class="tag t-head">head</span>', 'journal newer than the reader (message.delta)', he, '0.24.7')}
${row('<span class="tag t-head">head</span>', 'Session Store unreachable from the Harness', hs, 'current build')}
${row('<span class="tag t-base">base</span>', 'Session Store unreachable from the Harness', bs, 'current build')}
</table>
<h2>Current-build Harness stderr for the store outage (the only place the cause appears)</h2>
<pre>${esc(hs.r.harnessBStderrOpenFailed[0])}</pre>
<h2>Seen naturally during head roll-forward (transient, recovered on the next retry)</h2>
<pre>${esc(stale)}</pre>`;
  cards['04-open-failed-is-a-catch-all'] = page(
    'managed_session_open_failed means "Harness up, Session not opened" — not only "journal too new"',
    'Both Harness builds map every unclassified open() failure to the same 503 code; the released 0.24.7 catch-all does not even log the cause.',
    body,
    'Non-blocking doc precision: the design doc says the code lets the runbook tell "journal newer than the reader" apart from an unavailable Harness. On the wire it separates "Harness answered and refused" from "Harness down" — a Session Store outage, a stale writer grant or a Broker bind refusal produce the identical terminal code. A runbook still needs the fleet version mix (or current-build Harness stderr) to name the cause.',
  );
}

// ---------- Card 5: mutation matrix ----------
{
  const lines = readFileSync(`${RIG}/results/mutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const latest = new Map();
  for (const l of lines) latest.set(l[1], l);
  const why = {
    'C2 pattern accepts any char': 'weak mutant: Java <code>.</code> does not match <code>\\n</code>, so the forged-newline input is still rejected; C2b is the real check',
    'S3 log label is class name': '<b>unpinned:</b> no test asserts the retry/exhaustion log label — the PR\'s main observable claim (shown on the real stack in card 2)',
    'S4 explicit refusal catch removed': 'equivalent: the generic <code>catch (RuntimeException)</code> makes the identical <code>transientFailure</code> call',
  };
  const order = (id) => id.startsWith('BASELINE') ? '0' + id : id.replace(/^C2b/, 'C2~');
  const rows = [...latest.values()].sort((a, b) => order(a[1]).localeCompare(order(b[1]))).map((l) => {
    const v = l[2];
    const cls = v.startsWith('KILLED') || v.startsWith('PASS') ? 'ok' : 'warn';
    return `<tr><td class="mono">${esc(l[1])}</td><td class="${cls}">${esc(v)}</td><td class="mono">${esc(l[3]).replaceAll(',', ', ')}</td><td>${why[l[1]] ?? ''}</td></tr>`;
  }).join('');
  const killed = [...latest.values()].filter((l) => l[2].startsWith('KILLED')).length;
  const mutants = [...latest.values()].filter((l) => !l[1].startsWith('BASELINE')).length;
  cards['05-mutation-matrix'] = page(
    `Unit-test pins: ${killed}/${mutants} mutants killed`,
    'Anchored single-edit mutants in a dedicated worktree; HostedHarnessClientTest / HarnessCoordinatorTest run offline against the head arm\'s isolated m2; each verdict requires a parsed surefire total.',
    `<table><tr><th style="width:250px">Mutant</th><th style="width:130px">Verdict</th><th style="width:420px">Failing tests</th><th>Note</th></tr>${rows}</table>`,
    null,
  );
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1320, height: 900 } });
const pageObj = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  const file = `${FIG}/${name}.html`;
  writeFileSync(file, html);
  await pageObj.goto(`file://${file}`);
  const clipped = await pageObj.evaluate(() => [...document.querySelectorAll('pre, td, #card, table')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pageObj.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png clipped=${clipped}`);
}
await browser.close();
