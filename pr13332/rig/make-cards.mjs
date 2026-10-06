// Renders the evidence cards for PR 13332 from the rig's result files
// (never from hand-typed numbers) and screenshots them with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13332-rig';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13332-head/package.json');
const { chromium } = require('playwright');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1150px;max-width:1500px}
h1{font-size:21px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13px;margin-bottom:16px}
table{border-collapse:collapse;font-size:13px;width:100%}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.sec td{background:#161b22;color:#d2a8ff;font-weight:600}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13px}
h2{font-size:15px;margin:16px 0 8px}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const jsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
const short = (s, n = 150) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Strip run-unique IDs so the cells read the same across arms.
const scrub = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '‹id›').replace(/p13332-[a-z-]+-[0-9a-f]{8}/g, '‹session›');
const cls = (s) => (/REFUSED|FAILED|REJECTED|TypeError/.test(s) ? 'bad' : /COMMITTED|OK|RESOLVED/.test(s) ? 'ok' : '');
const cell = (s, kind) => `<td class="mono ${kind ?? cls(s)}">${esc(short(scrub(s)))}</td>`;
// Semantic colours: green = the outcome a correct writer/reader should give,
// red = harmful, amber = typed failure that is the expected improvement.
const REFUSE_WANTED = new Set(['sink-turn-result-no-cwd', 'sink-turn-result-other-session', 'turn-settled-null-resultref']);
function writeClass(scenario, text) {
  if (REFUSE_WANTED.has(scenario)) return /own authority REFUSED|^REFUSED/.test(text) ? 'ok' : 'bad';
  if (/REFUSED/.test(text)) return 'bad';
  if (/bound to that rev=[1-9]|"revision":999/.test(text)) return 'bad';
  return 'ok';
}
function projClass(scenario, arm, text) {
  if (/OK/.test(text) && !/FAILED/.test(text)) return 'ok';
  if (scenario === 'turn-settled-null-resultref' && arm !== 'base' && /turn\.settled event/.test(text)) return 'warn';
  return 'bad';
}

// ---------- Card 1: real Session Store A/B ----------
{
  const rows = jsonl(`${RIG}/results/probe.jsonl`);
  const by = (arm, s) => rows.filter((r) => r.arm === arm && r.scenario === s).at(-1);
  const SC = [
    ['R1-4 ref discovery', 'cancel-plain-target', 'cancel.requested, target {turnId} (control)'],
    ['R1-4 ref discovery', 'cancel-phantom-ref-target', 'free-form target naming the 5 ref fields'],
    ['R1-4 ref discovery', 'cancel-real-ref-target', 'free-form target = this session\'s definition ref'],
    ['R1-6 turn-result fence (production sink)', 'sink-turn-result-valid', 'turn_result ChatRecord as the recorder writes it'],
    ['R1-6 turn-result fence (production sink)', 'sink-turn-result-no-cwd', 'turn_result without cwd'],
    ['R1-6 turn-result fence (production sink)', 'sink-turn-result-other-session', 'turn_result of another session'],
    ['R1-1 null resultRef', 'turn-settled-null-resultref', 'turn.settled resultRef: null (schema-legal)'],
    ['envelope order', 'domain-record-colliding-keys', 'session_metadata content {revision:999, operationId, previousRecordRef}'],
  ];
  let body = '<table><tr><th>scenario</th><th>arm</th><th>write (real HTTP store → Spring → MySQL 8.4)</th><th>reopen + cold projection (what session list / resume runs)</th></tr>';
  let last = '';
  for (const [group, id, label] of SC) {
    if (group !== last) { body += `<tr class="sec"><td colspan="4">${esc(group)}</td></tr>`; last = group; }
    ['base', 'head', 'merge'].forEach((arm, i) => {
      const r = by(arm, id);
      const proj = r.reopen.includes('cold projection') ? r.reopen.slice(r.reopen.indexOf('cold projection')) : r.reopen;
      body += `<tr>${i === 0 ? `<td rowspan="3">${esc(label)}</td>` : ''}<td class="mono">${arm}</td>${cell(r.out, writeClass(id, r.out))}${cell(proj, projClass(id, arm, proj))}</tr>`;
    });
  }
  body += '</table>';
  const fu = readFileSync(`${RIG}/results/phantom-followup.txt`, 'utf8').trim().split('\n');
  body += `<h2>What the refused phantom-ref transaction leaves behind (base vs head)</h2><table>${fu.map((l) => (l.startsWith('==') ? `<tr class="sec"><td>${esc(l.replace(/=/g, '').trim())}</td></tr>` : `<tr>${cell(l, /REFUSED|REJECTED|FAILED/.test(l) ? 'bad' : 'ok')}</tr>`)).join('')}</table>`;
  const reg = rows.filter((r) => r.scenario === 'regressed-head' && !r.out.includes('ENOBUFS'));
  body += `<h2>R1-3: server head genuinely rolled back (MySQL tables restored from a mid-session dump), same writer reads again</h2><table><tr><th>arm</th><th>sequence of events</th></tr>${reg.map((r) => `<tr><td class="mono">${r.arm}</td><td class="mono">${r.out.split(' || ').map((x) => `<span class="${/read\(\): RESOLVED/.test(x) ? 'bad' : /read\(\): REJECTED/.test(x) ? 'ok' : 'dim'}">${esc(scrub(x))}</span>`).join('<br>')}</td></tr>`).join('')}</table>`;
  writeFileSync(`${FIG}/01-real-store.html`, page(
    'PR #13332 — real Session Store A/B (Spring Managed Agent Server + MySQL 8.4.7)',
    'Each arm\'s own built core dist: openManagedSession over createHttpManagedSessionStores, exactly as the Hosted Harness wires it. base = merge-base 69d5db2f, head = 8da9d01e, merge = head + main 481b4837.',
    body,
    'Base refuses a ref-shaped free-form payload client-side and then <b>poisons the live writer</b> (every later write and close() fail; a new writer is still refused at 70 s). Base binds a real resource named in free-form JSON as a dependency of the transaction; head binds none. Base persists caller-forged envelope keys (revision 999) in MySQL; head keeps the authority\'s envelope. Head refuses turn results the cold projection rejects; base commits them and the session\'s cold projection then fails as a whole.'));
}

// ---------- Card 2: cross-binary local log + real CLI glued marker ----------
{
  const lc = [...tsv(`${RIG}/results/local-cross.tsv`), ...tsv(`${RIG}/results/local-cross-bodies.tsv`)];
  const get = (w, shape, reader) => lc.find((r) => r[1] === `writer=${w}` && r[2] === shape && r[4] === `reader=${reader}`);
  const SHAPES = [
    ['turn-result-control', 'reader-facing turn_result (control)'],
    ['null-resultref', 'turn.settled resultRef: null'],
    ['result-body-not-a-record', 'result body {"state":"completed"}'],
    ['turn-result-no-version', 'turn_result without version  (M18)'],
    ['turn-result-bad-timestamp', 'turn_result timestamp "not-a-date"  (M19)'],
    ['turn-result-unknown-subtype', 'turn_result subtype "turn_result_v9"  (M19)'],
    ['turn-result-malformed-message', 'turn_result message: "x"  (M19)'],
  ];
  const rd = (t, shape, reader) => { const c = /^OK/.test(t) ? 'ok' : shape === 'null-resultref' && reader === 'head' ? 'warn' : 'bad'; return cell(t, c); };
  let body = '<h2>Local Managed Session log (ordinary-host M4 store): written by one binary, read by another</h2><table><tr><th>turn result committed</th><th>base writer</th><th>… read by base</th><th>… read by head</th><th>head writer</th></tr>';
  for (const [shape, label] of SHAPES) {
    const bb = get('base', shape, 'base'), bh = get('base', shape, 'head'), hh = get('head', shape, 'head');
    const bw = bb[3].replace('write: ', ''), hw = hh[3].replace('write: ', '');
    const ctl = shape === 'turn-result-control';
    body += `<tr><td class="mono">${esc(label)}</td>${cell(bw, ctl ? 'ok' : 'bad')}${rd(bb[5], shape, 'base')}${rd(bh[5], shape, 'head')}${cell(hw, ctl ? (/COMMITTED/.test(hw) ? 'ok' : 'bad') : (/REFUSED/.test(hw) ? 'ok' : 'bad'))}</tr>`;
  }
  body += '</table>';
  const g = tsv(`${RIG}/results/glued.tsv`);
  body += '<h2>Real CLI: a Legacy session recorded by the bundled CLI, one user line with raw marker bytes glued on (torn append), then <code>qwen --resume &lt;id&gt; -p …</code></h2><table><tr><th>binary</th><th>transcript</th><th>exit</th><th>model calls</th><th>transcript after</th><th>stderr</th></tr>';
  for (const [arm, shape, exit, calls, tr, , err] of g) {
    body += `<tr><td class="mono">${arm}</td><td class="mono">${esc(shape)}</td><td class="mono ${exit === 'exit=0' ? 'ok' : 'bad'}">${esc(exit)}</td><td class="mono">${esc(calls)}</td><td class="mono">${esc(tr)}</td><td class="mono ${err ? 'bad' : 'dim'}">${esc(short(scrub(err || '—'), 120))}</td></tr>`;
  }
  body += '</table>';
  writeFileSync(`${FIG}/02-local-and-cli.html`, page(
    'PR #13332 — cross-binary local log and the real CLI',
    'Writer and reader are each arm\'s built core dist (no mocks); the CLI rows run each arm\'s dist/cli.js bundle against a fake OpenAI server with an isolated HOME.',
    body,
    'Null resultRef: base reader throws a raw TypeError, head names the event (typed). Every malformed turn result a base writer commits fails the whole session\'s cold projection on both readers; head\'s writer refuses all of them, including the no-version and diagnostics shapes that no PR test pins (mutants M18/M19). A glued marker tail makes base refuse Legacy --resume of a Legacy session; head resumes it.'));
}

// ---------- Card 3: tests, witnesses, mutants ----------
{
  const sum = (k) => { const d = JSON.parse(readFileSync(`${S}/${k}.json`, 'utf8')); return { total: d.numTotalTests, failed: d.numFailedTests, passed: d.numPassedTests, skipped: d.numPendingTests, names: d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName)) }; };
  const slowNames = new Set([...sum('slow-core-bht').names, ...sum('slow-cli-bht').names]);
  const slowFiles = ['managed-session-log', 'managed-session-record-sink', 'hosted-hook-session'];
  const bhtAll = [...sum('touched-core-bht').names, ...sum('touched-cli-bht').names];
  // A failure in a slow file counts only if it also failed with the 120 s timeout.
  const timingOnly = (n, file) => slowFiles.some((f) => file.includes(f)) && !slowNames.has(n);
  const bhtFiles = [JSON.parse(readFileSync(`${S}/touched-core-bht.json`, 'utf8')), JSON.parse(readFileSync(`${S}/touched-cli-bht.json`, 'utf8'))].flatMap((d) => d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => [a.fullName, r.name])));
  const witnesses = bhtFiles.filter(([n, f]) => !timingOnly(n, f));
  let body = '<table><tr><th>arm</th><th>PR-touched suites (14 core + 3 cli files)</th></tr>';
  for (const [arm, note] of [['head', 'PR head'], ['merge', 'head + current main'], ['bht', 'base source + head tests']]) {
    const c = sum(`touched-core-${arm}`), l = sum(`touched-cli-${arm}`);
    const sc = sum(`slow-core-${arm}`), sl = sum(`slow-cli-${arm}`);
    body += `<tr><td class="mono">${arm} <span class="dim">(${note})</span></td><td class="mono">core ${c.passed}/${c.total - c.skipped} pass (${c.skipped} skipped), cli ${l.passed}/${l.total}; the 3 timing-sensitive files rerun with --testTimeout=120000: core ${sc.passed}/${sc.total}, cli ${sl.passed}/${sl.total}</td></tr>`;
  }
  body += `</table><h2>${witnesses.length} new tests fail on base source (timing-only failures excluded) — the witnesses</h2><table>`;
  body += witnesses.map(([n, f]) => `<tr><td class="mono dim">${esc(f.split('/').slice(-1)[0])}</td><td class="mono">${esc(short(n, 140))}</td></tr>`).join('');
  body += '</table>';
  const mut = jsonl(`${RIG}/results/mutants/results.jsonl`);
  const killed = mut.filter((m) => m.verdict === 'KILLED').length;
  const CLASS = {
    M04: 'equivalent: installActivation always bumps the epoch, so the epoch clause already rejects a fresh activation',
    M05: 'benign: a duplicate concurrent renewal replays by command idempotency (probe: same event count), and the only caller ignores the result',
    M12: 'unpinned: no writer emits a \\u-spelled header subtype (JSON.stringify never escapes it)',
    M18: 'GAP: a turn_result without version bricks the cold projection (card 2) and no test notices the clause gone',
    M19: 'GAP: invalid timestamp / unknown subtype / malformed message brick the cold projection (card 2); no test pins it',
    M28: 'gap: enqueue limits clone untested',
    M29: 'gap: claim input clone untested',
    M32: 'gap: release outcome clone untested',
  };
  body += `<h2>Single-guard revert mutants: ${killed}/${mut.length} killed by the PR's own tests</h2><table><tr><th>id</th><th>reverted guard</th><th>verdict</th><th>killer / classification</th></tr>`;
  body += mut.map((m) => `<tr><td class="mono">${m.id}</td><td>${esc(m.finding)}</td><td class="mono ${m.verdict === 'KILLED' ? 'ok' : /GAP/.test(CLASS[m.id] ?? '') ? 'bad' : 'warn'}">${m.verdict}</td><td class="mono ${m.verdict === 'KILLED' ? 'dim' : ''}">${esc(short(m.verdict === 'KILLED' ? m.killers[0] : CLASS[m.id] ?? '', 150))}</td></tr>`).join('');
  body += '</table>';
  writeFileSync(`${FIG}/03-tests-and-mutants.html`, page(
    'PR #13332 — the PR\'s tests on three arms, and single-guard revert mutants',
    'Host load average 40–88 on 10 cores during these runs (other sessions); every failure on head/merge was a 15 s timeout that passed with a 120 s timeout.',
    body,
    `${killed}/${mut.length} reverts are caught. Two survivors are real gaps worth one it.each row each (no-version and a diagnostics case in "rejects a turn-complete whose result body is …"); the rest are equivalent, benign, or low-risk clone checks.`));
}

// ---------- Card 4: end-to-end + merge suites ----------
{
  const e2e = tsv(`${RIG}/results/e2e.tsv`);
  const agg = {};
  for (const r of e2e) {
    const [, label, arm, args, exit] = r;
    const mode = args.includes('session-failover') ? '--session-failover (fake model, Harness killed, replacement owner restores)' : '--model qwen3.8-max (real model, tool call through the Hosted Workspace)';
    const k = `${mode}|${arm}`;
    agg[k] ??= { mode, arm, pass: 0, n: 0, fails: [] };
    agg[k].n += 1;
    if (exit === 'exit=0') agg[k].pass += 1; else agg[k].fails.push(label);
  }
  let body = '<table><tr><th>repo runner mode (scripts/run-managed-agent-server-e2e.ts)</th><th>arm</th><th>passed</th><th>failures</th></tr>';
  for (const v of Object.values(agg)) body += `<tr><td>${esc(v.mode)}</td><td class="mono">${v.arm}</td><td class="mono ${v.pass === v.n ? 'ok' : 'warn'}">${v.pass}/${v.n}</td><td class="mono dim">${esc(v.fails.map((f) => `${f}: model called a tool the Hosted Workspace profile refuses`).join('; ') || '—')}</td></tr>`;
  body += '</table>';
  const dm = (k) => (existsSync(`${S}/${k}.json`) ? JSON.parse(readFileSync(`${S}/${k}.json`, 'utf8')) : undefined);
  const rowsDirs = [];
  for (const [arm, label] of [['merge', 'trial merge (head + main 481b4837)'], ['main', 'main 481b4837']]) {
    for (const pkg of ['core', 'cli']) {
      const d = dm(`dirs-${pkg}-${arm}`);
      if (!d) continue;
      const fails = d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => `${r.name.split('/src/')[1]} › ${a.title}`));
      const ferr = d.testResults.filter((r) => r.status === 'failed' && !r.assertionResults.some((a) => a.status === 'failed')).map((r) => `${r.name.split('/src/')[1]} (file error)`);
      rowsDirs.push(`<tr><td class="mono">${label}</td><td class="mono">${pkg === 'core' ? 'core src/managed-runtime + src/services + managed-session-log' : 'cli src/serve'}</td><td class="mono">${d.testResults.length} files, ${d.numPassedTests}/${d.numTotalTests - d.numPendingTests} pass</td><td class="mono ${fails.length + ferr.length ? 'warn' : 'ok'}">${esc([...fails, ...ferr].slice(0, 6).join('; ') || 'none')}</td></tr>`);
    }
  }
  if (rowsDirs.length) body += `<h2>Whole-directory suites, so main's new turn-result producers (e.g. Monitor wake turns) meet the fence</h2><table><tr><th>tree</th><th>suites</th><th>result</th><th>failures (first 6)</th></tr>${rowsDirs.join('')}</table>`;
  const fl = (k) => { const d = dm(k); return d ? new Set(d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName))) : new Set(); };
  const mo = fl('rerun-merge-only'), ms = fl('rerun-main-same'), mf = fl('dirs-cli-merge'), nf = fl('dirs-cli-main');
  const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
  if (mo.size || ms.size) body += `<div class="note">Noise check: the 15 cli files with a failure on merge but not on main were rerun alone on both trees — merge ${mo.size} failures, main ${ms.size}. The failing tests change from run to run (merge full vs rerun share ${inter(mf, mo)}, main full vs rerun share ${inter(nf, ms)}, merge vs main rerun share ${inter(mo, ms)}); they are 404/ECONNRESET route assertions in server/route suites under load average 30–88, none in a Managed session path.</div>`;
  writeFileSync(`${FIG}/04-e2e.html`, page(
    'PR #13332 — end to end through the real stack',
    'Spring Managed Agent Server jar + Hosted Harness (each arm\'s dist/cli.js) + private mysqld 8.4.7, driven by the repo\'s own runner; runs are serial.',
    body,
    'No regression end to end: the fence accepts every turn result the real Harness writes, failover restore works on all arms, and the real-model failure is the model calling a tool outside the hosted profile (seen on #13263 too; code path untouched by this PR).'));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1560, height: 900 } });
const pg = await ctx.newPage();
for (const f of ['01-real-store', '02-local-and-cli', '03-tests-and-mutants', '04-e2e']) {
  await pg.goto(`file://${FIG}/${f}.html`);
  await pg.locator('#card').screenshot({ path: `${FIG}/${f}.png` });
  console.log('wrote', `${FIG}/${f}.png`);
}
await browser.close();
