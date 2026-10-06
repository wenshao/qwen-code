// VERIFICATION RIG ONLY (PR #13505): renders the evidence cards from the rig's result files
// (never from hand-typed numbers) and screenshots them with the head worktree's Playwright.
// usage: node make-cards.mjs [card numbers...]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13505-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13505-head/package.json');
const { chromium } = require('playwright');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:18px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1300px}
.note.red{border-left-color:#f85149}
.cols{display:flex;gap:24px;align-items:flex-start}
.num{text-align:right;font-variant-numeric:tabular-nums}
`;
const page = (title, sub, body, note, noteClass = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note ${noteClass}">${note}</div>` : ''}</div></body></html>`;

const cards = {};

// ---------- Card 1: TS <-> Java differential ----------
cards[1] = () => {
  const d = JSON.parse(readFileSync(`${RIG}/results/diff-summary.json`, 'utf8'));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const rowLabel = { 'one child_run': 'child_run body (shell + child_agent): parse / taskKind / recordId / isStart',
    'one child_acceptance': 'child_acceptance body: parse / isStart',
    'pair child_run': 'child_run successor pairs: isSuccessor',
    'pair child_acceptance': 'child_acceptance successor pairs: isSuccessor' };
  const corpus = Object.entries(d.rows).map(([k, v]) => `<tr><td>${esc(rowLabel[k] ?? k)}</td><td class="num mono">${fmt(v)}</td></tr>`).join('');
  const ex = [];
  for (const line of readFileSync(`${RIG}/diff/compare-head.txt`, 'utf8').split('\n')) if (line.startsWith('---')) ex.push(line);
  const fields = ['childRunId', 'ownerScopeId', 'rootSessionId'];
  const byField = fields.map((f) => `<tr><td class="mono">${f}</td><td class="num bad">${fmt(d.head[f] ?? 0)}</td><td class="num ok">${fmt(d.cand[f] ?? 0)}</td></tr>`).join('');
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const classes = readFileSync(`${RIG}/diff/classify-head.txt`, 'utf8').trim().split('\n').map((l) => {
    const m = l.match(/^(\d+) \('(\S+)', '(\S+)', '(.*)'\)/); return m ? [m[1], m[4]] : null; }).filter(Boolean);
  const classRows = classes.map(([n, msg]) => `<tr><td class="num">${n}</td><td class="mono">${esc(msg)}</td><td class="bad">accepted</td></tr>`).join('');
  return page('TS ↔ Java differential: the same JSON text through both record registries',
    `PR #13505 @ 904bfcf6 · ${fmt(d.total)} generated bodies/pairs (every shared fixture case and successor, single-point mutations at every path, value-pool swaps, raw numeric spellings, random multi-point mutations, cross-pairs) · TS: parseManagedSessionRecordJson + MANAGED_EXTENSION_RECORD_BODIES · Java: ManagedExtensionRecordStore.parse + ManagedExtensionProjection.RECORD_BODIES`,
    `<div class="cols"><div><h2>Corpus</h2><table><tr><th>operation</th><th>rows</th></tr>${corpus}</table>
     <h2>Verdict disagreements by field</h2><table><tr><th>field of a child_agent body</th><th>head jar</th><th>candidate jar (+3 lines)</th></tr>${byField}
     <tr><td><b>total</b></td><td class="num bad">${fmt(total(d.head))}</td><td class="num ok">${fmt(total(d.cand))}</td></tr></table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">All ${fmt(total(d.head))} disagreements are one shape: <b>Java accepts, TS refuses</b>. No other verdict, recordId, taskKind or isStart/isSuccessor disagreement.</div></div>
     <div><h2>What TS refuses and the head Java validator accepts</h2><table><tr><th>rows</th><th>TS refusal (Java: no error)</th><th>Java</th></tr>${classRows}</table></div></div>`,
    `<b>Cause:</b> <code>ManagedExtensionRecords.requireChildAgent</code> never runs <code>id(...)</code> on <code>childRunId</code>, <code>ownerScopeId</code> or <code>rootSessionId</code> (the shell branch does, lines 704–705; TS checks all three in <code>parseChildAgentRun</code>'s return). No shared fixture has a malformed value for these fields, so both replay suites stay green. Adding the three <code>id()</code> calls at the end of <code>requireChildAgent</code> (TS clause order) takes the disagreement count to 0 over the same corpus.`, 'red');
};

// ---------- Card 2: real stack — what the store accepts ----------
cards[2] = () => {
  const arms = ['base', 'head', 'cand'];
  const by = {};
  for (const arm of arms) for (const r of jsonl(`${RIG}/results/probe-${arm}.jsonl`)) if (r.scenario === 'id-parity') (by[r.case] ??= {})[arm] = r;
  const label = {
    control: 'faithful child_agent revision 1 (TS writer commits it)',
    'ownerScopeId-control-char': 'ownerScopeId "scope\\u0001main"', 'ownerScopeId-empty': 'ownerScopeId ""',
    'rootSessionId-NFD': 'rootSessionId "cafe\\u0301" (NFD)', 'rootSessionId-600B': 'rootSessionId of 600 bytes',
    'childRunId-control-char': 'childRunId "run\\u0007bell"', 'childRunId-number': 'childRunId 42', 'childRunId-null': 'childRunId null' };
  const cell = (r, arm) => {
    if (!r) return '<td class="dim">–</td>';
    if (r.case === 'control') {
      const ok = r.reopen === 'OPENED' && (arm !== 'base' ? (r.ts || '').startsWith('TS-ACCEPTED') : true);
      return `<td class="${arm === 'base' ? 'dim' : ok ? 'ok' : 'bad'}">${esc(arm === 'base' ? 'base TS writer refuses child_agent' : (r.ts || '') + ' · reopen ' + r.reopen)}</td>`;
    }
    const code = typeof r.code === 'object' && r.code ? r.code.code : '';
    if (r.http === 200) return `<td class="bad">200 stored · next open <b>${esc(r.reopen)}</b></td>`;
    if (r.http === 500) return `<td class="warn">500 ${esc(code)} · reopen ${esc(r.reopen)}</td>`;
    return `<td class="ok">${r.http} refused · reopen ${esc(r.reopen)}</td>`;
  };
  const order = ['control', 'ownerScopeId-control-char', 'ownerScopeId-empty', 'rootSessionId-NFD', 'rootSessionId-600B', 'childRunId-control-char', 'childRunId-number', 'childRunId-null'];
  const rows = order.map((c) => `<tr><td class="mono">${esc(label[c])}</td>${arms.map((a) => cell(by[c]?.[a], a)).join('')}<td class="mono dim">${esc((by[c]?.head?.ts || '').replace('TS-REFUSED: ', ''))}</td></tr>`).join('');
  const brickErr = by['ownerScopeId-control-char']?.head?.err ?? '';
  return page('Real stack: a writer commits a child_agent revision the TS authority would refuse',
    'Spring Managed Agent Server (Session Store) on MySQL 8.4.7 · a second writer with a valid writer token sends one domain.committed line over raw HTTP · then a fresh TypeScript authority (openManagedSession over the HTTP stores, as the Hosted Harness does) reopens the Session · base = main 43a6e1e5 jar, head = 904bfcf6 jar, candidate = head + 3 id() lines',
    `<table><tr><th>child_run body (kind child_agent)</th><th>base jar</th><th>head jar</th><th>candidate jar</th><th>what the TS authority says about the body</th></tr>${rows}</table>`,
    `<b>Head stores 5 of 7 bodies the TS reader cannot read back, and the Session can no longer be opened</b> (<code>${esc(brickErr)}</code>). A non-string <code>childRunId</code> reaches the INSERT with a null <code>record_id</code> and fails as <code>500 internal_error</code> (NOT NULL constraint) instead of 409. Base refuses all of them (no child_agent body at all), so this is new in this PR. The candidate refuses all 7 with <code>409 managed_session_extension_record_rejected</code> and the Session stays readable. Exposure today is limited: both domains stay disabled for submission and the real writer validates first. But this is the store-side guard the design relies on (“the store never accepts a line or a body that the authority could not read back”).`, 'red');
};

// ---------- Card 3: acceptance checks, faithful chain, mixed versions ----------
cards[3] = () => {
  const head = jsonl(`${RIG}/results/probe-head.jsonl`);
  const xr = head.filter((r) => r.scenario === 'java-cross-record');
  const xrRows = xr.map((r) => {
    const c = typeof r.code === 'object' && r.code ? r.code : null;
    const ok = r.case.includes('control') ? r.http === 200 : r.http === 409;
    return `<tr><td class="mono">${esc(r.case)}</td><td class="${ok ? 'ok' : 'bad'}">${r.http}</td><td class="mono">${esc(c ? c.message : '')}</td><td>${esc(r.reopen)}</td></tr>`;
  }).join('');
  const f = head.find((r) => r.scenario === 'faithful-chain');
  const views = f.views.map((v) => v.rev ? `child_run rev ${v.rev} @seq ${v.seq}${v.task ? ' → ' + v.task : ''}` : `child_acceptance rev ${v.acc} @seq ${v.seq}${v.taskId === null ? ' → no task' : ''}`).join('\n');
  const mixed = jsonl(`${RIG}/results/mixed.jsonl`).filter((r) => r.outcome !== 'PROBE-ERROR' || r.arm === 'headTS-on-baseJar');
  const mlabel = { 'base-reader': 'base TS authority reopens a head-written child_agent Session (head jar)',
    'head-reader': 'control: head TS authority, same Session',
    base: 'base jar + base TS write an H3 shell chain (rev 1–2)',
    'headTS-on-baseJar': 'new writer (head TS) commits child_agent to an old server (base jar)',
    upgrade: 'upgrade: head jar on that DB + head TS continue the shell chain (rev 3)',
    'downgrade-headTS': 'downgrade: base jar serves the head-written child_agent Session · head TS opens',
    'downgrade-baseTS': 'downgrade: same, base TS opens' };
  const mres = (r) => {
    if (r.scenario === 'shell-seed') return [`committed rev ${r.revs.join(',')} · ${r.views.join(',')}`, 'ok'];
    if (r.scenario === 'shell-continue') return [`${r.outcome} · ${r.before.join(',').replace(/task_\w+:/, '')} → ${r.after.join(',').replace(/task_\w+:/, '')}`, r.outcome.startsWith('COMMITTED') ? 'ok' : 'bad'];
    if (r.outcome === 'PROBE-ERROR') return [`refused by the store: ${r.error.slice(0, 95)}…`, 'ok'];
    if (r.status === 'OPENED') return [`OPENED · child_run ${r.run.join(',')} · acceptance ${r.acc.join(',')} · ${r.tasks.join(',')}`, 'ok'];
    return [`REFUSED (fail-stop): ${r.error.slice(0, 80)}…`, 'warn'];
  };
  const mixedRows = mixed.map((r) => { const [t, c] = mres(r); return `<tr><td>${esc(mlabel[r.arm] ?? r.arm)}</td><td class="${c} mono">${esc(t)}</td></tr>`; }).join('');
  const dva = jsonl(`${RIG}/results/probe-dva.jsonl`).filter((r) => r.arm === 'head');
  const dvaRows = dva.map((r) => `<tr><td class="mono">${esc(r.case)}</td><td class="mono">${esc(r.steps.join(' · '))}</td><td class="mono">acceptance ${esc(r.acc.join(',') || 'none')} · run ${esc(r.run.join(','))}</td></tr>`).join('');
  return page('Real stack: acceptance cross-record checks, the full lifecycle, and mixed versions',
    'Head jar 904bfcf6 + head core dist on MySQL 8.4.7 (all 23 probe rows rerun on the current head d17f5101 jar + dist: identical outcomes) · child_run / child_acceptance enabled in the probe process only (the authority suite\'s own mock, applied to dist) · cross-record cases committed by a raw-HTTP writer, so the Java store is the only check',
    `<div class="cols"><div><h2>Java store: acceptance cross-record checks (rogue writer, 12 cases)</h2>
     <table><tr><th>case</th><th>HTTP</th><th>409 message</th><th>reopen</th></tr>${xrRows}</table></div>
     <div><h2>Faithful lifecycle through the real authority + store</h2><pre class="mono" style="margin:0;background:#161b22;padding:8px 12px;border:1px solid #30363d">${esc(views)}
replay of accept-1:1 → rev ${f.replay.rev}, replayed=${f.replay.replayed}, seq ${f.replay.seq}
conflicting redelivery → ${esc(f.redelivery.replace('REFUSED ManagedSessionConflictError: ', 'refused (conflict): '))}
fresh reopen → ${f.reopen.status} · child_run ${f.reopen.run} · acceptance ${f.reopen.acc} · tasks ${f.reopen.tasks}
MySQL rows: child_run task_kind=child_agent completed / delivery consumed
            child_acceptance task_kind=NULL / delivery consumed
task journal: 4 state_changed (pending→running→running→completed)</pre>
     <h2>Mixed versions</h2><table><tr><th>step</th><th>result</th></tr>${mixedRows}</table></div></div>
     <h2>Observation: the run's delivery line never consults the acceptance record (both arms accept)</h2>
     <table><tr><th>case</th><th>child_run delivery commits after settle</th><th>end state</th></tr>${dvaRows}</table>`,
    'Every acceptance rule the design lists answers <code>409 managed_session_extension_record_rejected</code> from the real store with the same clause the TS authority uses, and no refused commit leaves the Session unreadable. Old readers fail-stop exactly as decision 1 says. Upgrading an H3 Shell chain needs no migration and keeps <code>background_shell</code>. The last table is by design (“three independent facts”). But a run marked <code>rejected</code> while its acceptance says <code>accepted</code> is a state H4b\'s relay/dispatcher must not trust. That is a question for H4b, not a blocker here.');
};

// ---------- Card 4: suites and mutants ----------
cards[4] = () => {
  const ts = tsv(`${RIG}/results/ts.tsv`);
  const rerun = tsv(`${RIG}/results/ts-rerun.tsv`);
  const jt = tsv(`${RIG}/results/jtest.tsv`);
  const it = tsv(`${RIG}/results/it.tsv`);
  const suites = ['head', 'merge', 'cand'].map((l) => {
    const t = readFileSync(`${RIG}/logs/suite-${l}.log`, 'utf8');
    const m = [...t.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();
    const errs = [...t.matchAll(/managedagent\.(\w+\.\w+)[^\n]*<<< (?:ERROR|FAILURE)!$/gm)].map((x) => x[1]);
    return `<tr><td>${l}</td><td class="mono">run ${m[1]} · failed ${m[2]} · errors ${m[3]} · skipped ${m[4]}</td><td class="mono warn">${esc(errs.join(', '))}</td></tr>`;
  }).join('');
  const row = (cells, cls = '') => `<tr>${cells.map((c, i) => `<td class="${i ? 'mono ' : ''}${cls}">${esc(c)}</td>`).join('')}</tr>`;
  const tsRows = ts.map((r) => row([`${r[1]} · ${r[2]}`, r[3], r[5]], r[3] === 'exit=0' ? 'ok' : 'warn')).join('');
  const rerunRows = rerun.map((r) => row([`isolated rerun ${r[1]} · ${r[2]}`, r[3], r[4]], r[3] === 'exit=0' ? 'ok' : 'bad')).join('');
  const jtMain = jt.filter((r) => !r[1].startsWith('toolpub'));
  const JL = { 'cand-fixed': 'candidate: Java fix + 3 fixtures (3 contract tests)', 'cand-fixtures-only-headJava': 'witness: 3 new fixtures on head Java (must fail)', 'store-on-mysql-head': 'PR ManagedExtensionRecordStoreTest on MySQL 8.4.7', 'cand-store-test-on-head': 'candidate store test on PR head' };
  const jtRows = jtMain.map((r) => row([JL[r[1]] ?? r[1], r[2], r[3].replace('[INFO] ', '').replace('[ERROR] ', '')], r[2] === 'exit=0' ? 'ok' : (r[1].includes('fixtures-only') ? 'ok' : 'bad'))).join('');
  const tally = (rows, re) => { const t = {}; for (const r of rows) { const m = r[1].match(re); if (!m) continue; const a = m[1]; t[a] ??= [0, 0]; t[a][1]++; if (r[2] === 'exit=0') t[a][0]++; } return Object.entries(t).map(([a, [p, n]]) => `${a} ${p}/${n}`).join(' · '); };
  const abRows = [
    row(['ToolPublicationStoreTest (class, isolated + interleaved)', '', tally(jt, /^toolpub(?:class)?-(\w+)/)], 'dim'),
    row(['…the failing method alone, interleaved', '', tally(jt, /^toolpub1-(\w+)-/)], 'ok'),
    row(['hosted-harness-session “fences recovery” ×6, interleaved', '', (() => { const t = {}; for (const r of tsv(`${RIG}/results/ab-fences.tsv`)) { t[r[2]] ??= [0, 0]; t[r[2]][1]++; if (r[4] === 'exit=0') t[r[2]][0]++; } return Object.entries(t).map(([a, [p, n]]) => `${a} ${p}/${n} runs green`).join(' · '); })()], 'ok'),
  ].join('');
  const itRows = it.map((r) => row([`MySQL ITs (failsafe) · ${r[1]}`, r[2], r[4]], r[2] === 'exit=0' ? 'ok' : 'bad')).join('');
  const mut = tsv(`${RIG}/results/mutants.tsv`);
  const mutC = tsv(`${RIG}/results/mutants-with-candidate-test.tsv`);
  const candOf = Object.fromEntries(mutC.filter((r) => r[0] !== 'BASELINE').map((r) => [r[0], r[1]]));
  const desc = { 'J1-kind': 'drop “names a child_agent run”', 'J2-settled': 'drop “ended with its result”', 'J3-scope': 'drop scope match',
    'J4-call': 'drop completion-call match', 'J5-content': 'drop content-digest binding', 'J6-receipt': 'drop receipt-digest binding',
    'J7-closure-agent': 'drop inputRef/resultRef/terminalReceiptRef closure', 'J8-closure-acceptance': 'drop acceptance resource closure',
    'J9-taskkind-null': 'non-task rows keep task_state (pre-existing expr.)',
    'T1-kind': 'drop “names a child_agent run”', 'T2-settled': 'drop “ended with its result”', 'T3-scope': 'drop scope match',
    'T4-call': 'drop completion-call match', 'T5-content': 'drop content-digest binding', 'T6-receipt': 'drop receipt-digest binding',
    'T7-closure-agent': 'drop child_agent resource closure', 'T8-closure-acceptance': 'drop acceptance resource closure' };
  const mutRows = mut.filter((r) => r[0] !== 'BASELINE').map((r) => `<tr><td class="mono">${r[0]}</td><td>${esc(desc[r[0]] ?? '')}</td><td class="${r[1] === 'KILLED' ? 'ok' : 'bad'}">${r[1]}</td><td class="${candOf[r[0]] ? (candOf[r[0]] === 'KILLED' ? 'ok' : 'bad') : 'dim'}">${candOf[r[0]] ?? '–'}</td></tr>`).join('');
  const base = mut.filter((r) => r[0] === 'BASELINE').map((r) => `${r[1]}: ${r[3]}, ${r[4]}`).join(' · ');
  return page('Regression suites, store suite on MySQL, and targeted mutants of the cross-record checks',
    'Native MySQL 8.4.7 for every MySQL-backed run · host load 35–160 on 10 cores during the runs (concurrent sessions) · mutants are anchored single edits; a mutant is KILLED only if the suite ran (count > 0) and failed',
    `<div class="cols"><div><h2>Java managed-agent-server, full surefire (unit)</h2><table><tr><th>arm</th><th>result</th><th>errors</th></tr>${suites}</table>
     <h2>Focused Java runs</h2><table><tr><th>run</th><th>exit</th><th>result</th></tr>${jtRows}${itRows}</table>
     <h2>Flake A/B (base vs head)</h2><table><tr><th>test</th><th></th><th>passing runs per arm</th></tr>${abRows}</table>
     <h2>TypeScript</h2><table><tr><th>suite</th><th>exit</th><th>result</th></tr>${tsRows}${rerunRows}</table></div>
     <div><h2>Mutants of the acceptance commit checks</h2><table><tr><th>id</th><th>mutation</th><th>PR suites</th><th>+ candidate test</th></tr>${mutRows}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">${esc(base)} · Java suites: ManagedExtensionRecordStoreTest + the three contract tests · TS: authority child-agent + child-run suites</div></div></div>`,
    'Every red line in the suites is a timing failure (15 s vitest timeouts, ECONNRESET, publication-claim expiry) at host load 40–160. In isolated reruns, record-sink and child-run-supervisor pass on every arm. What still fails is hook-scale (times out on base too) plus one hosted-harness-session case per run (a different one each time, base included). The two failures that looked head-specific pass in interleaved base/head A/B: fences ×6 4/4 on both arms, ToolPublicationStoreTest class 2/2 on both, its failing method 3/3 on both. Mutants: the Java store suite has no case for four acceptance rules (kind, completion call, receipt digest, child_agent resource closure), and the TS authority suite misses two (receipt digest, child_agent resource closure); the receipt binding is pinned in neither language. Candidate tests (Java 66 lines, TS 2 cases) pass on the PR head and kill all six. J9 is a pre-existing gap in how non-task rows are written, not new here.');
};

const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(cards);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1700, height: 1200 } });
const pg = await ctx.newPage();
const names = { 1: '01-ts-java-differential', 2: '02-store-accepts-unreadable-bodies', 3: '03-acceptance-lifecycle-mixed-versions', 4: '04-suites-and-mutants' };
for (const n of which) {
  const html = cards[n]();
  const file = `${FIG}/${names[n]}.html`;
  writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${FIG}/${names[n]}.png` });
  console.log(`card ${n} -> ${names[n]}.png (clipped pre: ${clipped})`);
}
await browser.close();
