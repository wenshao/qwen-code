// VERIFICATION RIG ONLY (PR #13505 round 2): evidence cards for head 0a1b1d2e, rendered from result files.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13505-rig';
const FIG = `${RIG}/fig/r2`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13505-h2/package.json');
const { chromium } = require('playwright');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:18px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
pre{margin:0;background:#161b22;padding:8px 12px;border:1px solid #30363d;white-space:pre}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1300px}
.note.red{border-left-color:#f85149}
.cols{display:flex;gap:24px;align-items:flex-start}
.del{color:#ffa198}.add{color:#7ee787}
`;
const page = (title, sub, body, note, cls = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note ${cls}">${note}</div>` : ''}</div></body></html>`;
const vd = (f) => readFileSync(`${RIG}/diff/${f}`, 'utf8').split('VERDICT-DIFFS ')[1].split('\n')[0];
const n785 = (s) => { const m = s.match(/'accept': (\d+)/); return m ? Number(m[1]) : 0; };

const cards = {};
cards[1] = () => {
  const r1 = jsonl(`${RIG}/results/probe-head.jsonl`);
  const h2 = jsonl(`${RIG}/results/probe-h2.jsonl`);
  const m2 = jsonl(`${RIG}/results/probe-m2.jsonl`);
  const idCell = (rows) => {
    const ids = rows.filter((r) => r.scenario === 'id-parity' && r.case !== 'control');
    const c = (pred) => ids.filter(pred).length;
    const ok = c((r) => r.http === 409 && r.reopen === 'OPENED');
    return [`${ok}/${ids.length} → 409 · ${c((r) => r.http === 200)} stored (${c((r) => r.reopen === 'REFUSED')} Sessions unopenable) · ${c((r) => r.http === 500)}× 500`, ok === ids.length ? 'ok' : 'bad'];
  };
  const xrCell = (rows) => {
    const x = rows.filter((r) => r.scenario === 'java-cross-record');
    const ok = x.filter((r) => (r.case.includes('control') ? r.http === 200 : r.http === 409) && r.reopen === 'OPENED').length;
    return [`${ok}/${x.length} as expected (10 × 409, 2 controls 200)`, ok === x.length ? 'ok' : 'bad'];
  };
  const same = (a, b) => JSON.stringify(a.map((r) => [r.scenario, r.case, r.http, r.reopen?.status ?? r.reopen])) === JSON.stringify(b.map((r) => [r.scenario, r.case, r.http, r.reopen?.status ?? r.reopen]));
  const jt = Object.fromEntries(tsv(`${RIG}/results/jtest.tsv`).map((r) => [r[1], r]));
  const rows = [
    ['TS ↔ Java differential, 573,903 rows', [`${n785(vd('compare-head.txt'))} disagreements`, 'bad'], [`${n785(vd('compare-h2.txt'))} disagreements`, 'ok'], [`${n785(vd('compare-m2.txt'))} disagreements`, 'ok']],
    ['Real stack: 7 malformed child_agent identities (raw-HTTP writer)', idCell(r1), idCell(h2), idCell(m2)],
    ['Real stack: acceptance cross-record checks', xrCell(r1), xrCell(h2), xrCell(m2)],
    ['All 23 probe rows vs round-1 candidate jar', ['(baseline)', 'dim'], [same(h2, jsonl(`${RIG}/results/probe-cand.jsonl`)) ? 'identical' : 'DIFFERENT', 'ok'], [same(m2, jsonl(`${RIG}/results/probe-cand.jsonl`)) ? 'identical' : 'DIFFERENT', 'ok']],
    ['PR store suite on native MySQL 8.4.7', [jt['store-on-mysql-head']?.[3].replace('[INFO] ', '') ?? '', 'ok'], [jt['store-on-mysql-h2-exact']?.[3].replace('[INFO] ', '') ?? '', 'ok'], ['–', 'dim']],
  ];
  const t = rows.map(([l, ...cells]) => `<tr><td>${esc(l)}</td>${cells.map(([v, c]) => `<td class="${c} mono">${esc(v)}</td>`).join('')}</tr>`).join('');
  const m1 = Object.fromEntries(tsv(`${RIG}/results/mutants.tsv`).filter((r) => r[0] !== 'BASELINE').map((r) => [r[0], r[1]]));
  const m2r = Object.fromEntries(tsv(`${RIG}/results/mutants-r2.tsv`).filter((r) => r[0] !== 'BASELINE').map((r) => [r[0], r[1]]));
  const mc = {};
  for (const f of ['mutants-r2-with-j7b-test.tsv', 'mutants-r2-with-t7b-test.tsv']) for (const r of tsv(`${RIG}/results/${f}`)) if (r[0] !== 'BASELINE') mc[r[0]] = r[1];
  const desc = { 'J1-kind': 'acceptance names a child_agent run', 'J4-call': 'completion-call match', 'J6-receipt': 'receipt-digest binding', 'J7-closure-agent': 'child_agent closure (all three refs)',
    'J7b-closure-result-receipt': 'closure of resultRef + terminalReceiptRef only', 'J9-taskkind-null': 'non-task rows keep task_state (pre-existing)',
    'JF1-id-childRunId': 'F1: id(childRunId)', 'JF2-id-ownerScopeId': 'F1: id(ownerScopeId)', 'JF3-id-rootSessionId': 'F1: id(rootSessionId)',
    'T6-receipt': 'receipt-digest binding', 'T7-closure-agent': 'child_agent closure (all three refs)', 'T7b-closure-result-receipt': 'closure of resultRef + terminalReceiptRef only' };
  const ids = ['J1-kind', 'J4-call', 'J6-receipt', 'J7-closure-agent', 'J7b-closure-result-receipt', 'JF1-id-childRunId', 'JF2-id-ownerScopeId', 'JF3-id-rootSessionId', 'J9-taskkind-null', 'T6-receipt', 'T7-closure-agent', 'T7b-closure-result-receipt'];
  const k = (v) => v ? `<td class="${v === 'KILLED' ? 'ok' : 'bad'}">${v}</td>` : '<td class="dim">–</td>';
  const mt = ids.map((id) => `<tr><td class="mono">${id}</td><td>${esc(desc[id])}</td>${k(m1[id])}${k(m2r[id])}${k(mc[id])}</tr>`).join('');
  const others = tsv(`${RIG}/results/mutants-r2.tsv`).filter((r) => r[0] !== 'BASELINE' && !ids.includes(r[0]));
  const othersKilled = others.filter((r) => r[1] === 'KILLED').length;
  return page('Round 2 (0a1b1d2e): the F1 fix and the F2 tests, re-verified',
    'Same rig as round 1: Spring Session Store on native MySQL 8.4.7, real TS authority over HTTP, raw-HTTP second writer · h2 = PR head 0a1b1d2e · m2 = trial merge of h2 into current main f3642d4e (13 newer commits, incl. H5 channels + V47)',
    `<table><tr><th>check</th><th>round 1 head 904bfcf6</th><th>h2 0a1b1d2e</th><th>m2 trial merge</th></tr>${t}</table>
     <h2>Mutants (anchored single edits; KILLED = suite ran and failed)</h2>
     <table><tr><th>id</th><th>removed check</th><th>round 1 suites</th><th>round 2 suites (h2)</th><th>+ round-2 candidate test</th></tr>${mt}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">Also killed on h2: ${othersKilled}/${others.length} other acceptance mutants (J2, J3, J5, J8, T1–T5, T8).</div>`,
    'F1 is closed: zero differential disagreements on h2 and on the trial merge, 7/7 malformed identities refused with 409 on the real store, and every other probe row unchanged. The six round-1 mutant survivors are now killed, along with the three F1 id() removals. Two new survivors remain: the closure of a settling revision\'s <code>resultRef</code> + <code>terminalReceiptRef</code>, in both languages. The author noted the Java one while re-running mutants. The code enforces it (409 <code>managed_session_resource_missing</code> on the real store). One extra case per language kills it.');
};

cards[2] = () => {
  const f3 = tsv(`${RIG}/results/f3-probe.tsv`);
  const AL = { head: 'round-1 head 904bfcf6 (same file)', candidate: 'round-1 head + candidate', 'h2-0a1b1d2e': 'h2 0a1b1d2e', 'h2+candidate-f3': 'h2 + candidate (parseChildShellRun)' };
  const rows = f3.map(([arm, out]) => `<tr><td class="mono">${esc(AL[arm] ?? arm)}</td><td class="${out.startsWith('REFUSED') ? 'ok' : 'bad'} mono">${esc(out)}</td></tr>`).join('');
  const code = `// packages/core/src/managed-runtime/local-shell-stream-result-session.ts (h2)
const DOMAINS = {
  child_run: {
    label: 'Background Shell',
<span class="del">-    parse: parseChildRun,        // accepts kind "shell" AND "child_agent" since this PR</span>
<span class="add">+    parse: parseChildShellRun,   // candidate: shell only, as the PR did for the cli consumers</span>
  },
  ...
// prepare(): the record is looked up by the capture's executionCallId, then
const record = this.session.authority.extensionRecord(this.recordDomain, capture.executionCallId);
const run = domain.parse(record.record).run;   // child_agent passes here on h2
if (run.executionCallId !== capture.executionCallId ||
    (run.execution !== 'dispatch_started' && run.execution !== 'running_attached')) throw …`;
  const sc = jsonl(`${RIG}/results/probe-h2-settle.jsonl`).map((r) => `<tr><td class="mono">${esc(r.case)}</td><td class="${(r.case === 'control' ? r.http === 200 : r.http === 409) ? 'ok' : 'bad'}">${r.http} ${esc(r.code ?? '')}</td><td>${esc(r.reopen)} · ${esc(r.run.join(','))}</td></tr>`).join('');
  return page('Round 2: one shell-only consumer still parses with the widened parser (F3)',
    'The PR moved the cli shell consumers from parseChildRun to parseChildShellRun. LocalShellStreamResultSession (core) still uses parseChildRun to prove a Background Shell\'s start. Witness: a child_agent child_run keyed agent-1 (run.executionCallId agent-1, dispatch_started), then prepare() for a background capture of agent-1.',
    `<div class="cols"><div><h2>Background Shell capture admission against a child_agent record</h2>
     <table><tr><th>code</th><th>prepare(requestFor('agent-1'))</th></tr>${rows}</table>
     <h2>Code</h2><pre>${code}</pre></div>
     <div><h2>Real stack: J7b behaviour (settling revision, raw-HTTP writer, h2 jar)</h2>
     <table><tr><th>settled revision cites</th><th>store answer</th><th>reopen</th></tr>${sc}</table></div></div>`,
    'On base no child_agent record can exist, so this is new with the PR. It is latent while child_run stays disabled. Once H4b enables it, a background-shell capture whose call ID matches a child agent\'s key and start call is admitted against that child\'s run and opens a capture stream for it. The candidate is one import and one line. The existing suite still passes (4/4), and a new case fails without the fix ("promise resolved … instead of rejecting") and passes with it.', 'red');
};

cards[3] = () => {
  const ts = tsv(`${RIG}/results/ts.tsv`).filter((r) => ['h2', 'm2'].includes(r[2]));
  const it = tsv(`${RIG}/results/it.tsv`).filter((r) => r[1] === 'm2');
  const jt = tsv(`${RIG}/results/jtest.tsv`).filter((r) => /h2-exact|j7b/.test(r[1]));
  const suite = existsSync(`${RIG}/logs/suite-m2.log`) ? (() => { const t = readFileSync(`${RIG}/logs/suite-m2.log`, 'utf8'); const m = [...t.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].sort((a, b) => Number(b[1]) - Number(a[1]))[0]; const e = [...t.matchAll(/managedagent\.(\w+\.\w+)[^\n]*<<< (?:ERROR|FAILURE)!$/gm)].map((x) => x[1]); return m ? [`run ${m[1]} · failed ${m[2]} · errors ${m[3]} · skipped ${m[4]}`, e.join(', ')] : ['(no summary)', '']; })() : ['(not run)', ''];
  const ab = tsv(`${RIG}/results/ab-r2.tsv`);
  const mixed = jsonl(`${RIG}/results/mixed.jsonl`).filter((r) => r.arm === 'm2-upgrade');
  const row = (a, b, c, cls) => `<tr><td>${esc(a)}</td><td class="mono ${cls}">${esc(b)}</td><td class="mono dim">${esc(c)}</td></tr>`;
  const body = [
    ...ts.map((r) => row(`TS ${r[1]} · ${r[2]}`, r[5].trim().replace(' | ', ' · '), r[3], r[3] === 'exit=0' ? 'ok' : 'warn')),
    row('Java managed-agent-server surefire · m2', suite[0], suite[1], suite[0].includes('errors 0') && suite[0].includes('failed 0') ? 'ok' : 'warn'),
    ...it.map((r) => row(`Java MySQL ITs (failsafe) · m2`, r[4].replace('[INFO] ', ''), r[3], r[2] === 'exit=0' ? 'ok' : 'bad')),
    ...jt.map((r) => row(`Java ${r[1]}`, r[3].replace('[INFO] ', ''), r[2], r[2] === 'exit=0' ? 'ok' : 'bad')),
    ...ab.map((r) => row(`A/B whole hosted-harness-session.test.ts · ${r[2]} · run ${r[3]}`, r[5].trim().replace(' | ', ' · '), (r[6] ?? '').replace(/;$/, ''), r[4] === 'exit=0' ? 'ok' : 'warn')),
    ...mixed.map((r) => row('Upgrade: round-1 DB (V46, 34 child_agent + 6 acceptance rows) → m2 jar (V47)', `${r.status} · child_run ${r.run} · acceptance ${r.acc} · ${r.tasks}`, 'Flyway applied V47', r.status === 'OPENED' ? 'ok' : 'bad')),
  ].join('');
  return page('Round 2: suites on the head and on the trial merge with current main',
    'm2 = 0a1b1d2e merged into main f3642d4e (H5 channel contracts + V47, glob admission, H4/H5/H6 designs, 10 more); merge is textually clean, compiles, and no main code uses the renamed Body.taskKind / shell-typed parseChildRun',
    `<table><tr><th>run</th><th>result</th><th>notes</th></tr>${body}</table>`,
    'NOTE3');
};

const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(cards);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1700, height: 1200 } });
const pg = await ctx.newPage();
const names = { 1: 'r2-01-fix-verification', 2: 'r2-02-shell-capture-parser', 3: 'r2-03-suites' };
for (const n of which) {
  let html = cards[n]();
  if (n === '3') html = html.replace('NOTE3', readFileSync(`${RIG}/r2-note3.txt`, 'utf8'));
  const file = `${FIG}/${names[n]}.html`;
  writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${FIG}/${names[n]}.png` });
  console.log(`card ${n} -> ${names[n]}.png (clipped pre: ${clipped})`);
}
await browser.close();
