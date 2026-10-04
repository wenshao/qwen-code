// Renders the evidence cards for PR 13336 from the rig's result files
// (never from hand-typed numbers) and screenshots them with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13336-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13336-head/package.json');
const { chromium } = require('playwright');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:18px}
table{border-collapse:collapse;font-size:13.5px}
th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.sec td{background:#161b22;color:#d2a8ff;font-weight:600}
.note{margin-top:16px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1240px}
.cols{display:flex;gap:22px}.col{flex:1;min-width:560px}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;margin:1px 2px;font-family:ui-monospace,Menlo,monospace}
.p-delta{background:#033a16;color:#7ee787}.p-task{background:#5a1e02;color:#ffa657;font-weight:700}.p-other{background:#21262d;color:#8b949e}.p-term{background:#0c2d6b;color:#79c0ff}
.part{display:inline-block;border:2px solid #3fb950;border-radius:6px;padding:4px 12px;margin:2px 6px 2px 0;font-family:ui-monospace,Menlo,monospace}
.part.split{border-color:#f85149}
h2{font-size:16px;margin:14px 0 8px}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;

// ---------- Card 1: R3-2 rogue-writer matrix ----------
// The reserved-ID row comes from its follow-up run (rogue-reserved), listed first.
const rows = ['rogue-reserved', 'rogue-r1', 'rogue-r2'].flatMap((f) => readFileSync(`${RIG}/results/${f}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
const reserved = readFileSync(`${RIG}/results/rogue-reserved.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const by = (arm, s) => rows.find((r) => r.arm === arm && r.scenario === s);
const ENVELOPE = ['no-envelope', 'event-extra-field', 'wrong-sequence', 'event-other-session', 'unknown-kind', 'unknown-subtype', 'unknown-domain', 'bodyless-extra-field', 'bodyless-version-2', 'reserved-event-id'];
const RESIDUE = ['payload-empty-turn-settled', 'payload-wrong-type', 'payload-absent', 'delta-without-activation-subject', 'subject-malformed', 'record-sessionId-mismatch', 'marker-extra-field', 'marker-wrong-eventsDigest', 'marker-broken-chain', 'two-markers', 'stageh-wrong-ordinal'];
const R11 = { 'payload-empty-turn-settled': '(1)', 'payload-wrong-type': '(1)', 'payload-absent': '(2)', 'delta-without-activation-subject': '(3)', 'subject-malformed': '(4)', 'record-sessionId-mismatch': '(5)', 'marker-extra-field': '(6)', 'marker-wrong-eventsDigest': '(6)', 'marker-broken-chain': '(6)', 'two-markers': '(7)', 'stageh-wrong-ordinal': '(8)' };
const UNWITNESSED = { 'event-extra-field': 'M13', 'event-other-session': 'M15' };
const LABEL = {
  control: 'faithful cancel.requested event (control)',
  'no-envelope': 'event line without managedSession envelope',
  'wrong-sequence': 'second event at sequence +5',
  'unknown-kind': 'event kind "not_a_kind"',
  'unknown-subtype': 'record subtype "not_a_subtype" after header',
  'unknown-domain': 'domain.committed of "not_a_domain"',
  'bodyless-extra-field': 'goal_state payload with extra field',
  'bodyless-version-2': 'goal_state payload version 2',
  'reserved-event-id': 'ordinary event takes ID "monitor_run:1"',
  'payload-empty-turn-settled': 'turn.settled with payload {}',
  'payload-wrong-type': 'cancel.requested reason = 42',
  'delta-without-activation-subject': 'message.delta without activation subject',
  'subject-malformed': 'event subject {"bogus":true}',
  'record-sessionId-mismatch': 'record envelope sessionId of another Session',
  'marker-extra-field': 'commit marker with extra field',
  'marker-wrong-eventsDigest': 'commit marker eventsDigest mismatch',
  'marker-broken-chain': 'commit marker previousCommitDigest mismatch',
  'event-extra-field': 'event envelope with an extra field',
  'event-other-session': 'ordinary event whose sessionKey names another Session',
  'payload-absent': 'event with no payload key',
  'two-markers': '[marker, marker] declared as eventCount 1',
  'stageh-wrong-ordinal': 'Monitor revision 1 committed as monitor_run:2',
  'stageh-control': 'Monitor revision 1 committed as monitor_run:1 (control)',
};
const short = (r) => r.reopen.startsWith('OPENED') ? '<span class="ok">opens</span>' : `<span class="bad">REFUSED</span> <span class="dim mono">${esc(r.reopen.replace('REFUSED: ', '').slice(0, 64))}</span>`;
const harmed = (r) => !r.reopen.startsWith('OPENED') || /REFUSED/.test(r.reopen);
const commitCell = (r) => r.commit === 200 ? `<span class="${harmed(r) ? 'bad' : 'ok'}">200 stored</span>` : `<span class="ok">${r.commit} refused</span> <span class="dim mono">${esc((r.message || '').slice(0, 52))}</span>`;
const line = (s) => {
  const b = by('base', s), h = by('head', s);
  let baseReopen = short(b), headReopen = short(h);
  if (s === 'stageh-control' || s === 'stageh-wrong-ordinal') {
    const good = s === 'stageh-control';
    for (const r of [b, h]) if (!r.reopen.includes(good ? 'revision 2 COMMITTED' : 'revision 2 REFUSED: event id monitor_run:2 is already committed')) throw new Error('stageh follow-up mismatch ' + s);
    const cell = good ? '<span class="ok">opens</span>, authority\'s revision 2 <span class="ok">commits</span>' : '<span class="ok">opens</span>, then the authority\'s own revision 2 <span class="bad">refused forever</span> <span class="dim mono">(monitor_run:2 already committed)</span>';
    baseReopen = cell; headReopen = cell;
  }
  if (s === 'reserved-event-id') {
    const rb = reserved.find((r) => r.arm === 'base'), rh = reserved.find((r) => r.arm === 'head');
    baseReopen = `<span class="ok">opens</span>, then <span class="bad">Monitor's own monitor_run:1 refused</span> <span class="dim mono">(already committed)</span>`;
    headReopen = `<span class="ok">opens</span>, Monitor's monitor_run:1 <span class="ok">commits</span>`;
    if (!rb.reopen.includes('REFUSED: event id monitor_run:1 is already committed') || !rh.reopen.includes('COMMITTED')) throw new Error('reserved follow-up mismatch');
  }
  const tag = R11[s] ? ` <span class="dim">R1-1 ${R11[s]}</span>` : UNWITNESSED[s] ? ` <span class="warn" style="font-size:11.5px">no test (${UNWITNESSED[s]} survives)</span>` : '';
  return `<tr><td>${esc(LABEL[s])}${tag}</td><td>${commitCell(b)}</td><td>${baseReopen}</td><td>${commitCell(h)}</td><td>${headReopen}</td></tr>`;
};
const card1 = page(
  'R3-2 · a writer holding a valid writer token commits ONE crafted line',
  `Real Spring jars (base <code>eb0b79c5</code> / head <code>6ee195a</code>) + MySQL 8.4.7 · the real TypeScript authority creates each Session through the HTTP Session Store, a second writer commits one transaction over raw HTTP, a fresh authority reopens it exactly as the Hosted Harness does (<code>openManagedSession</code>)`,
  `<table><tr><th>crafted line</th><th>base commit</th><th>base reopen</th><th>head commit</th><th>head reopen</th></tr>
  ${line('control')}
  ${line('stageh-control')}
  <tr class="sec"><td colspan="5">Rules this PR mirrors (R3-2's listed fix) — 10/10 now refused at commit, the Session keeps opening</td></tr>
  ${ENVELOPE.map(line).join('')}
  <tr class="sec"><td colspan="5">Rules the mirror still lacks (/review R1-1) — 11/11 still stored on head, same as base: 10 brick the next open, 1 wedges the Stage H chain</td></tr>
  ${RESIDUE.map(line).join('')}</table>`,
  `Head closes every rule R3-2 listed. The residue rows are not a regression (base fails identically) and no production writer emits them — the authority's own HTTP client validates every line before sending — but they mean the R3-2 problem statement (“one bad line bricks a Session at the next open”) still holds — exactly the gap /review R1-1 lists. Not counted: a duplicate event ID inside one transaction (stored, Session still opens) and a <code>checkpoint.committed</code> covering its own sequence (the reader throws the scanner's coverage error, but my control checkpoint is refused by a different rule, so the row is not clean).`,
);

// ---------- Card 2: R3-3 split ----------
const splitRuns = readdirSync(`${RIG}/runs`).filter((d) => /^split-(base|head)-(1|4|r\d)$/.test(d) && existsSync(`${RIG}/runs/${d}/items.json`) || /^split-(base-1|head-4)$/.test(d));
const summary = { base: [], head: [] };
for (const d of readdirSync(`${RIG}/runs`).filter((x) => /^split-(base|head)-(1|4|r[234])$/.test(x))) {
  const arm = d.split('-')[1];
  if (!existsSync(`${RIG}/runs/${d}/parts.tsv`)) continue;
  const parts = readFileSync(`${RIG}/runs/${d}/parts.tsv`, 'utf8').trim().split('\n').filter((l) => l.split('\t')[2] === 'output_text').map((l) => l.split('\t')[3]);
  const events = JSON.parse(readFileSync(`${RIG}/runs/${d}/events.json`, 'utf8'));
  const outbox = readFileSync(`${RIG}/runs/${d}/outbox.tsv`, 'utf8').trim();
  summary[arm].push({ d, parts, events, outbox });
}
const latest = (arm) => summary[arm].find((r) => r.d.endsWith('r4'));
const pills = (events) => events.map((e) => {
  const cls = e.type === 'task.updated' ? 'p-task' : e.type === 'item.output_text.delta' ? 'p-delta' : e.terminal ? 'p-term' : 'p-other';
  const t = e.type === 'item.output_text.delta' ? `${e.sequence} delta "${esc(e.data?.text)}"` : `${e.sequence} ${e.type}`;
  return `<span class="pill ${cls}">${t}</span>`;
}).join(' ');
const items = (arm) => JSON.parse(readFileSync(`${RIG}/runs/split-${arm}-r4/items.json`, 'utf8')).data.find((i) => i.role === 'assistant').content.map((p) => p.text);
const tally = (arm) => summary[arm].map((r) => r.parts.length === 1 ? 'one Part' : `${r.parts.length} Parts`);
const col = (arm, jar) => {
  const r = latest(arm);
  const parts = items(arm);
  return `<div class="col"><h2>${arm} <span class="dim mono">${jar}</span></h2>
  <div class="dim">public event stream (<code>GET /v1/agents/sessions/{id}/events</code>)</div><div style="margin:6px 0 12px">${pills(r.events)}</div>
  <div class="dim">assistant message (<code>GET …/items</code>)</div><div style="margin:6px 0 12px">${parts.map((p) => `<span class="part ${parts.length > 1 ? 'split' : ''}">output_text: "${esc(p)}"</span>`).join('')}</div>
  <div class="dim">task-event outbox (<code>qwen_managed_session_task_event</code>)</div><div class="mono" style="margin:6px 0 12px">${r.outbox.includes('\t') ? (([t, st, rev, seq]) => `task_${esc(t.slice(5, 17))}… state=${esc(st)} revision=${esc(rev)} first_sequence=${esc(seq)}`)(r.outbox.split('\t')) : esc(r.outbox)}</div>
  <div class="dim">all runs: ${summary[arm].length} × → ${[...new Set(tally(arm))].map((t) => `<b class="${t === 'one Part' ? 'ok' : 'bad'}">${t}</b>`).join(', ')} (${tally(arm).join(' / ')})</div></div>`;
};
const card2 = page(
  'R3-3 · a Monitor revision committed between two streamed text deltas of one assistant message',
  'Real Spring jar + MySQL 8.4.7 + Hosted Harness (Workspace-bound Session, the only kind that streams <code>message.delta</code> commits) · fake model streams "one" | trigger | "two" · H3 preview: the Harness bundle copy enables <code>monitor_run</code> and its authority commits the shared fixture\'s first monitor_run revision at the trigger',
  `<div class="cols">${col('base', 'eb0b79c5')}${col('head', '6ee195a')}</div>`,
  'Base announces <code>task.updated</code> on the Session event stream between the two deltas, and the frozen v1 message projection stores the reply as two durable Parts. Head keeps the stream to the turn\'s own events, stores one Part <code>"onetwo"</code>, and the announcement lands in the V35 outbox; the task list serves the Monitor either way. Upgrade check: head on a copy of the base database applies V35, keeps the old <code>task.updated</code> event and split Parts readable, and announces the Session\'s next two Monitor revisions on the outbox only.',
);

// ---------- Card 3: R3-1 ----------
const exec = readFileSync(`${RIG}/runs/cancel-head-1/execution.tsv`, 'utf8').trim().split('\t');
const mapping = readFileSync(`${RIG}/results/r3-1-mapping.txt`, 'utf8').trim().split('\n');
const storeBase = readFileSync(`${RIG}/results/r3-1-store-base.txt`, 'utf8').trim().split('\n');
const storeHead = readFileSync(`${RIG}/results/r3-1-store-head.txt`, 'utf8').trim().split('\n');
const finalTask = (lines) => (lines.find((l) => l.startsWith('RESULT')).match(/finalTask=(\S+)/) || [])[1].replace('@settled', ', settled');
const proxy = readFileSync(`${RIG}/runs/cancel-head-1/proxy.log`, 'utf8').trim().split('\n').map((l) => l.replace('/internal/runtime-broker/v1', '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '…'));
const card3 = page(
  'R3-1 · a tool call cancelled before any dispatch claim, end to end',
  'Real Spring jar with its embedded Runtime Broker + MySQL 8.4.7 + Hosted Harness · fake model asks for one <code>write_file</code>; a pass-through proxy holds <code>executions/…:start</code>, the turn is cancelled through <code>POST /api/agent/web-shell/v1/turns/cancel</code>',
  `<h2>1 · what the real Broker stores (<code>qwen_tool_execution</code>)</h2>
  <table><tr><th>execution_state</th><th>execution_status</th><th>dispatch_generation</th><th>dispatch_owner</th><th>cancel_requested</th><th>result_json</th></tr>
  <tr class="mono"><td>${exec[1]}</td><td>${exec[2]}</td><td><b>${exec[3]}</b></td><td>${exec[4]}</td><td>${exec[5]}</td><td>${esc(exec[6])}</td></tr></table>
  <div class="dim mono" style="margin-top:6px;font-size:11.5px">${esc(proxy.join('  ·  '))}</div>
  <h2>2 · each jar's own <code>ManagedExtensionProjection.executionOf</code> on that row</h2>
  <div class="mono">${mapping.map((m) => esc(m).replace('= settled', '= <span class="bad">settled</span>').replace('= not_started_proven', '= <span class="ok">not_started_proven</span>')).join('<br>')}</div>
  <h2>3 · the Monitor's settling revision built from that mapping, committed to the arm's real store</h2>
  <table><tr><th>arm</th><th>revision 1 (admitted, intent)</th><th>revision 2 (cancelled, stop_requested)</th><th>task view after</th></tr>
  <tr><td>base</td><td>${esc(storeBase[0].split('\t').slice(2).join(' '))}</td><td><span class="bad">${esc(storeBase[1].split('\t')[1])} · 409</span> <span class="dim mono">${esc((storeBase[1].match(/"message":"([^"]+)"/) || [])[1] || '')}</span></td><td class="bad">${esc(finalTask(storeBase))} (stuck)</td></tr>
  <tr><td>head</td><td>${esc(storeHead[0].split('\t').slice(2).join(' '))}</td><td><span class="ok">${esc(storeHead[1].split('\t')[1])} · 200</span></td><td class="ok">${esc(finalTask(storeHead))}</td></tr></table>`,
  'The Broker really writes <code>SETTLED / cancelled / dispatchGeneration 0 / no owner</code> for a call cancelled before its claim — exactly the new <code>settled-cancelled-not-claimed</code> fixture row. Base maps it to <code>settled</code>, and the record contract refuses <code>intent → settled</code>, so the Monitor\'s task view can never leave pending; head maps it to <code>not_started_proven</code> and the revision commits. <code>executionOf</code> has no production caller today (/review R1-6), so this probe stands in for the future one.',
);

// ---------- Card 4: mutants + suites ----------
const mutants = readFileSync(`${RIG}/results/mutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t')).sort((a, b) => Number(a[0].match(/^M(\d+)/)[1]) - Number(b[0].match(/^M(\d+)/)[1]));
const e2e = readFileSync(`${RIG}/results/e2e.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const suites = JSON.parse(readFileSync(`${RIG}/results/suites.json`, 'utf8'));
const DESC = {
  'M0-baseline': 'no change (baseline)',
  'M1-generation-ignored': 'R3-1: drop the dispatchGeneration == 0 clause',
  'M2-event-kind-vocabulary': 'R3-2: skip the 16-kind vocabulary check',
  'M3-reserved-event-ids': 'R3-2: allow <domain>:<n> event IDs',
  'M4-domain-membership': 'R3-2: skip domain membership',
  'M5-outbox-write': 'R3-3: never write the outbox row',
  'M6-announce-on-event-stream': 'R3-3: also announce task.updated on the event stream',
  'M7-unknown-subtype-anywhere': 'R3-2: tolerate unknown subtypes after the header',
  'M8-commit-marker-cap': 'R3-2: drop the 64 KiB commit-marker cap',
  'M9-one-stage-h-per-tx': 'R3-2: allow two Stage H revisions in one transaction',
  'M10-sequence-place': 'R3-2: accept any event sequence',
  'M11-deleting-session-announces': 'R3-3: announce on a Session being deleted',
  'M12-header-cap': 'R3-2: drop the 64 KiB header cap',
  'M13-envelope-closedness': 'R3-2: accept unknown envelope fields',
  'M14-body-less-payload-closed': 'R3-2: skip body-less domain payload checks',
  'M15-own-session-every-event': 'R3-2: skip the own-Session check on ordinary events',
};
const card4 = page(
  'Mutation witnesses, suites and production-writer runs',
  `Mutants: one anchored edit each in a separate worktree, ${mutants[0][2].replace('tests=', '')} tests of the six suites the PR touches, file restored byte-identical after each run`,
  `<div class="cols"><div class="col" style="min-width:860px"><table><tr><th style="min-width:330px">mutant</th><th>verdict</th><th>failing tests</th></tr>
  ${mutants.map((m) => `<tr><td>${esc(DESC[m[0]] ?? m[0])}</td><td class="${m[1] === 'KILLED' ? 'ok' : m[0] === 'M0-baseline' && m[1] === 'SURVIVED' ? 'dim' : 'warn'}">${m[0] === 'M0-baseline' ? 'all pass' : m[1]}</td><td class="mono" style="font-size:11.5px">${esc((m[6] || '').split(',').map((t) => t.replace('ManagedExtensionRecordStoreTest.', 'RecordStore.').replace('ManagedExtensionProjectionContractTest.', 'ProjectionContract.')).join(', '))}</td></tr>`).join('')}</table></div>
  <div class="col" style="max-width:560px"><table><tr><th>run (head 6ee195a)</th><th>result</th></tr>
  ${suites.map((s) => `<tr><td>${esc(s.name)}</td><td class="${s.ok ? 'ok' : 'warn'}">${esc(s.result)}</td></tr>`).join('')}
  ${e2e.map((r) => `<tr><td>E2E <code>${esc(r[2])}</code> <span class="dim">${esc(r[1].replace('e2e-', ''))}</span></td><td class="${r[3] === 'exit=0' ? 'ok' : 'bad'}">${r[3] === 'exit=0' ? 'pass' : esc(r[3])} · ${esc(r[4])}</td></tr>`).join('')}
  </table></div></div>`,
  (() => { const real = mutants.filter((m) => m[0] !== 'M0-baseline'); const killed = real.filter((m) => m[1] === 'KILLED'); const survived = real.filter((m) => m[1] === 'SURVIVED'); return `${killed.length} of ${real.length} mutants killed. Survivors: ${survived.map((m) => esc(DESC[m[0]])).join('; ')} — the header cap is the gap triage and /review R1-11/R1-13 named; the other two are rules this PR adds and enforces (the real-stack rows in the R3-2 card show both refusing) with no test that fails without them.`; })(),
);

const cards = { '01-r3-2-rogue-writer-matrix': card1, '02-r3-3-message-split': card2, '03-r3-1-broker-cancel': card3, '04-mutants-and-suites': card4 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
for (const [name, html] of Object.entries(cards)) {
  writeFileSync(`${FIG}/${name}.html`, html);
  const p = await ctx.newPage();
  await p.goto(`file://${FIG}/${name}.html`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td,div')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'hidden').length);
  await p.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png clipped=${clipped}`);
  await p.close();
}
await browser.close();
