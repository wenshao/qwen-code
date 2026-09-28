// Builds the evidence cards from the raw logs and screenshots them with Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.REPO_PACKAGE_JSON ?? process.cwd() + '/package.json');
const { chromium } = require('playwright');
const SP = process.argv[2];
const L = (f) => fs.readFileSync(path.join(SP, 'logs', f), 'utf8');
const rows = (f) => Object.fromEntries(L(f).split('\n').filter(Boolean).slice(1).map((l) => { const r = JSON.parse(l); return [r.case, r]; }));
const header = (f) => L(f).split('\n')[0];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtNum = (s) => s.replace(/\d{4,}/g, (d) => Number(d).toLocaleString('en-US'));

function cell(r) {
  if (!r) return { text: '-', tone: 'n' };
  const out = [];
  const first = r['POST /executions'] || r.createExecution || '';
  out.push((r['POST /executions'] ? 'POST ' : 'createExecution ') + first.replace(/^threw /, 'threw ').replace(/: Runtime execution dispatch failed|: reference is invalid/, ''));
  const sql = (r.sql || '').replace(/ head=.*/, '').replace('len(reference_json)', 'ref_json').replace('len(result_json)', 'result_json');
  out.push('row: ' + fmtNum(sql));
  if (r['GET /executions/{id}']) out.push('GET ' + r['GET /executions/{id}']);
  if (r['fresh repository read']) out.push('restart read: ' + r['fresh repository read'].replace('JSONException: ', '').replace(' (max 10000)', ''));
  if (r.reconcile) out.push('reconcile: ' + r.reconcile);
  out.push('release ' + (r['release after reconcile'] || r.release));
  const t = out.join('\n');
  let tone = 'g';
  if (/Number literal too long/.test(t)) tone = 'r';
  else if (/runtime_session_busy|UNKNOWN|ArithmeticException/.test(t)) tone = 'a';
  return { text: t, tone };
}

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:900px}
h1{font-size:22px;margin:0 0 4px 0;color:#f0f6fc} .sub{color:#8b949e;font-size:13px;margin-bottom:16px;font-family:ui-monospace,Menlo,monospace}
table{border-collapse:collapse;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
th{background:#161b22;color:#c9d1d9;text-align:left;padding:7px 10px;border:1px solid #30363d;font-weight:600}
td{vertical-align:top;padding:7px 10px;border:1px solid #30363d;white-space:pre;line-height:1.45}
td.case{color:#c9d1d9;background:#11161d;white-space:pre-wrap;max-width:300px}
td.r{background:#3d1417;color:#ffb3b3} td.g{background:#0f2a18;color:#aff5b4} td.a{background:#33260a;color:#f8d98b} td.n{color:#c9d1d9}
.note{margin-top:14px;border-left:3px solid #58a6ff;padding:6px 12px;color:#c9d1d9;font-size:13.5px;max-width:1500px;line-height:1.5}
.legend span{display:inline-block;padding:1px 8px;margin-right:8px;border-radius:3px;font-size:12px;font-family:ui-monospace,Menlo,monospace}
pre{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:#161b22;border:1px solid #30363d;padding:10px 12px;margin:0;line-height:1.45;white-space:pre}
.cols{display:flex;gap:16px} .col{flex:1} .col h2{font-size:14px;margin:0 0 6px 0;color:#c9d1d9}
`;
const legend = `<div class="legend" style="margin:0 0 12px 0"><span style="background:#3d1417;color:#ffb3b3">row persisted but unreadable</span><span style="background:#33260a;color:#f8d98b">UNKNOWN / Session pinned / unmapped error</span><span style="background:#0f2a18;color:#aff5b4">clean outcome</span></div>`;
const page = (title, sub, body, note) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div>`;

function table(cases, arms) {
  let h = '<table><tr><th>case</th>' + arms.map((a) => `<th>${esc(a.label)}</th>`).join('') + '</tr>';
  for (const [id, label] of cases) {
    h += `<tr><td class="case">${esc(label)}</td>`;
    for (const a of arms) { const c = cell(a.rows[id]); h += `<td class="${c.tone}">${esc(c.text)}</td>`; }
    h += '</tr>';
  }
  return h + '</table>';
}

const base = rows('rs-base-mysql84.txt'), pr = rows('rs-pr-mysql84.txt'), cand = rows('rs-cand-mysql84.txt');
const hb = header('rs-base-mysql84.txt');
const env = 'Broker HTTP API → RuntimeBrokerService → JDBC repositories on MySQL 8.4.11; MariaDB 10.11.18 rows identical (0 diffs) · JDK 21.0.12 · fastjson2 2.0.65';

const figs = [];
// 01 unit A/B + mutation
{
  const baseLog = L('test-base-full.log'), prLog = L('test-pr-full.log');
  const pick = (log, re) => log.split('\n').filter((l) => re.test(l)).map((l) => l.replace(/^\[(INFO|ERROR|WARNING)\] /, '').replace(/com\.alibaba\.qwen\.code\.runtimebroker\./g, '').replace(/ -- Time elapsed: [0-9.]+ s/g, '').replace(/, Time elapsed: [0-9.]+ s/, ''));
  const a = pick(baseLog, /Tests run:.*BrokerValuesTest|^\[ERROR\]   BrokerValuesTest\.|Tests run: 376|BUILD/).join('\n');
  const b = pick(prLog, /Tests run:.*BrokerValuesTest|Tests run: 376|Checkstyle violations|BUILD/).join('\n');
  const mut = JSON.parse(fs.readFileSync(path.join(SP, 'harness/mutation/results-BrokerValuesTest.json'), 'utf8'));
  const mt = mut.map((m) => `${m.id.padEnd(4)} ${m.verdict.padEnd(9)} ${m.desc}${m.killedBy.length ? '  ← ' + m.killedBy.map((k) => k.replace('BrokerValuesTest.', '')).join(', ') : ''}`).join('\n');
  const body = `<div class="cols"><div class="col"><h2>A · base 233d49b5cc + the PR's BrokerValuesTest.java</h2><pre>${esc(a)}</pre></div><div class="col"><h2>B · PR head f2efb16ff7 (mvn -o test checkstyle:check)</h2><pre>${esc(b)}</pre></div></div>
  <h2 style="font-size:14px;margin:16px 0 6px 0;color:#c9d1d9">Mutation of the guard (javac one class → surefire BrokerValuesTest) — 12/13 killed, original class hash restored</h2><pre>${esc(mt)}</pre>`;
  figs.push(['01-unit-ab-and-mutation', page('PR #12870 · unit A/B, full module suite, guard mutation', 'packages/sdk-java/runtime-broker · JDK 21.0.12 (Zulu) · Maven 3.9.16 · macOS 26 arm64', body,
    'The three negative-side tests fail on the base with "Expected IllegalArgumentException … but nothing was thrown" and pass on the PR; the module suite is 376 tests, 0 failures on the PR; the 2 skips (both arms) are the two real-TypeScript-worker tests that need a CLI bundle, and <code>managedContextRoundtripUsesFakeWorker</code> — the author’s one environmental error — passes here. Every behavioural mutant of the guard — including both <code>Math.abs</code>/negation overflow variants at <code>Integer.MIN_VALUE</code> and both off-by-one boundaries — is killed by the new tests. M13 (exception text) survives by design: nothing asserts the message.')]);
}
// 02 real-stack A/B
{
  const cases = [
    ['api-ref-1E100000', 'Java API createExecution\nreference.input = 1E+100000\n(scale −100000)'],
    ['api-ref-minscale', 'Java API createExecution\nreference.input scale = Integer.MIN_VALUE'],
    ['e-1E100000', 'embedder RuntimeTransport\nresult = 1E+100000'],
    ['e-1E2049', 'embedder RuntimeTransport\nresult = 1E+2049 (plain: 2,050 digits)'],
    ['e-1E2048', 'embedder RuntimeTransport\nresult = 1E+2048 (boundary)'],
    ['e-minscale', 'embedder RuntimeTransport\nresult scale = Integer.MIN_VALUE'],
    ['http-ref-1E100000', 'Broker HTTP API\nreference literal 1E+100000'],
    ['w-1E100000', 'production HttpRuntimeTransport v2\nworker answers literal 1E+100000'],
  ];
  const body = legend + table(cases, [{ label: 'base 233d49b5cc', rows: base }, { label: 'PR f2efb16ff7', rows: pr }]);
  figs.push(['02-real-stack-ab', page('PR #12870 · real-stack A/B on MySQL / MariaDB', env, body,
    'Reference path (Java API): the base writes a PREPARED row whose <code>reference_json</code> is 100,142 bytes, every later read fails with <code>Number literal too long: 100001 digits</code>, and the Runtime Session can no longer be released; the PR answers 400 with no row. Result path (embedder transport): the base stores a SETTLED row nobody can read (GET 500, restart read fails); the PR stores no result — the execution becomes UNKNOWN, reconciliation with the Runtime\'s same answer is refused (502), so release stays 409 <code>runtime_session_busy</code>. For 1E+2049…1E+9999 the base round-tripped cleanly, so on the result path the conservative bound turns a working call into UNKNOWN. Wire paths never produced these scales: fastjson2 refuses exponent literals ≥ 2048 on both the request codec and the worker-response reader.')]);
}
// 03 residual + candidate
{
  const cases = [
    ['e-bigint-10001d', 'embedder RuntimeTransport\nresult = BigInteger 10^10000\n(10,001 digits; type not checked)'],
    ['e-prec7953-s-2048', 'embedder RuntimeTransport\nresult = 9{7953} × 10^2048\n(scale −2048: inside ±2048)'],
    ['w-9x8000E2047', 'production HttpRuntimeTransport v2\nworker answers 9{8000}E+2047\n(8,006-byte literal, exponent < 2048)'],
    ['w-1E400', 'control: worker answers 1E+400'],
  ];
  const body = legend + table(cases, [{ label: 'base 233d49b5cc', rows: base }, { label: 'PR f2efb16ff7', rows: pr }, { label: 'candidate: PR + digit budget (+26 lines)', rows: cand }]) +
    `<h2 style="font-size:14px;margin:16px 0 6px 0;color:#c9d1d9">fastjson2 2.0.65 reader budget, measured on plain literals</h2><pre>${esc(`integer 10000 digits                -> OK        integer 10001 digits      -> Number literal too long: 10001 digits
integer 7952 + fraction 2048 digits -> OK        7953 + 2048               -> Number literal too long: 10001 digits
fraction 2049 digits                -> scale overflow : 2049      exponent literal 1E+2048 -> too large exp value : 2048
=> readable plain form: fraction digits <= 2048 AND total digits <= 10000; the +-2048 scale bound only covers the first`)}</pre>`;
  figs.push(['03-residual-and-candidate', page('PR #12870 · unreadable rows the ±2048 bound still admits (pre-existing)', env, body,
    'All three persist a SETTLED row on the base <i>and</i> on the PR: GET answers 500 and a restarted repository fails with <code>Number literal too long</code>. The third one travels over the shipped v2 wire: the worker-response reader uses <code>UseBigDecimalForDoubles</code>, so a mantissa-heavy literal with exponent 2047 becomes a BigDecimal of scale −2047 whose plain form has 10,047 digits. (The shipped TypeScript worker cannot emit it — <code>JSON.stringify</code> writes at most 17 significant digits — but any other Runtime can.) The candidate adds a plain-digit budget for BigDecimal and BigInteger: 379 tests, 0 failures, checkstyle clean; no unreadable row on either database. On the result path those values then land in UNKNOWN, the same trade-off as the PR.')]);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1200 } });
const pg = await ctx.newPage();
for (const [name, html] of figs) {
  const file = path.join(SP, 'figs', name + '.html');
  fs.writeFileSync(file, html);
  await pg.goto('file://' + file);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: path.join(SP, 'figs', name + '.png') });
  const box = await pg.locator('#card').boundingBox();
  console.log(name, 'clipped=' + clipped, Math.round(box.width) + 'x' + Math.round(box.height));
}
await browser.close();
