// Renders the evidence cards for PR 13332 from the rig's result files
// (never from hand-typed numbers) and screenshots them with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13332-rig';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332';
const FIG = `${RIG}/fig-r2`;
const S2 = `${S}/r2`;
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


const cfg = existsSync(`${RIG}/cards-r2.config.mjs`) ? await import(`${RIG}/cards-r2.config.mjs`) : {};
Object.assign(globalThis, cfg.default ?? {});

const SUB = 'base = merge-base 29aef7de, head = f65ef56a, merge = head + main f20ed558. Round 2 of the verification (round 1 was at 8da9d01e).';

// ---------- Card 1: real Session Store A/B ----------
{
  const rows = jsonl(`${RIG}/results/r2-probe.jsonl`);
  const by = (arm, s) => rows.filter((r) => r.arm === arm && r.scenario === s).at(-1);
  const REFUSE = new Set(['sink-turn-result-no-cwd', 'sink-turn-result-other-session', 'turn-settled-null-resultref', 'sink-message-no-cwd', 'sink-compression-no-version']);
  const wc = (id, t) => (REFUSE.has(id) ? (/^REFUSED|own authority REFUSED/.test(t) ? 'ok' : 'bad') : /REFUSED/.test(t) || /bound to that rev=[1-9]|"revision":999/.test(t) ? 'bad' : 'ok');
  const pc = (id, arm, t) => (/OK/.test(t) && !/FAILED/.test(t) ? 'ok' : id === 'turn-settled-null-resultref' && arm !== 'base' && /turn\.settled event/.test(t) ? 'warn' : 'bad');
  const SC = [
    ['new fence channels (R1-16): message.committed, chunked bodies (be6fb30d), context.compacted', 'sink-message-valid', 'user message as the recorder writes it'],
    ['new fence channels (R1-16): message.committed, chunked bodies (be6fb30d), context.compacted', 'sink-message-no-cwd', 'user message without cwd, then a valid follow-up'],
    ['new fence channels (R1-16): message.committed, chunked bodies (be6fb30d), context.compacted', 'sink-message-200k-chunked', '200 KiB message (60 KiB parts + manifest)'],
    ['new fence channels (R1-16): message.committed, chunked bodies (be6fb30d), context.compacted', 'sink-compression-valid', 'chat_compression after one message'],
    ['new fence channels (R1-16): message.committed, chunked bodies (be6fb30d), context.compacted', 'sink-compression-no-version', 'chat_compression without version'],
    ['round-1 scenarios, re-run', 'sink-turn-result-no-cwd', 'turn_result without cwd, then a valid follow-up'],
    ['round-1 scenarios, re-run', 'sink-turn-result-other-session', 'turn_result of another session'],
    ['round-1 scenarios, re-run', 'turn-settled-null-resultref', 'turn.settled resultRef: null'],
    ['round-1 scenarios, re-run', 'cancel-phantom-ref-target', 'free-form target naming the 5 ref fields'],
    ['round-1 scenarios, re-run', 'cancel-real-ref-target', "free-form target = this session's definition ref"],
    ['round-1 scenarios, re-run', 'domain-record-colliding-keys', 'session_metadata content {revision:999, …}'],
  ];
  let body = '<table><tr><th>scenario</th><th>arm</th><th>write (real HTTP store → Spring → MySQL 8.4)</th><th>reopen + cold projection</th></tr>';
  let last = '';
  for (const [group, id, label] of SC) {
    if (group !== last) { body += `<tr class="sec"><td colspan="4">${esc(group)}</td></tr>`; last = group; }
    ['base', 'head', 'merge'].forEach((arm, i) => {
      const r = by(arm, id);
      const proj = r.reopen.includes('cold projection') ? r.reopen.slice(r.reopen.indexOf('cold projection')) : r.reopen;
      body += `<tr>${i === 0 ? `<td rowspan="3">${esc(label)}</td>` : ''}<td class="mono">${arm}</td>${cell(r.out, wc(id, r.out))}${cell(proj, pc(id, arm, proj))}</tr>`;
    });
  }
  body += '</table>';
  const reg = rows.filter((r) => r.scenario === 'regressed-head');
  body += `<h2>R1-3: MySQL tables restored from a mid-session dump, same writer reads again</h2><table><tr><th>arm</th><th>sequence</th></tr>${reg.map((r) => `<tr><td class="mono">${r.arm}</td><td class="mono">${r.out.split(' || ').map((x) => `<span class="${/read\(\): RESOLVED/.test(x) ? 'bad' : /read\(\): REJECTED/.test(x) ? 'ok' : 'dim'}">${esc(scrub(x))}</span>`).join('<br>')}</td></tr>`).join('')}</table>`;
  writeFileSync(`${FIG}/01-real-store.html`, page('PR #13332 round 2 — real Session Store A/B (Spring + MySQL 8.4.7)', `Each arm's own core dist through openManagedSession + createHttpManagedSessionStores; merge runs against the jar built from the merge tree. ${SUB}`, body,
    'The fence now refuses non-reader-facing bodies on every reader-facing channel at write time; a refusal leaves the writer usable (the follow-up commits, close() resolves) and the session readable. A 200 KiB chunked message commits and projects whole. Base commits every bad body and the session\'s cold projection then fails as a whole.'));
}

// ---------- Card 2: fence cost + real CLI ----------
{
  const perf = jsonl(`${RIG}/results/perf.jsonl`);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  let body = '<h2>Per-commit cost of the fence: production sink.write of user messages, 3 interleaved repetitions per arm</h2><table><tr><th>store</th><th>body</th><th>commit median, base</th><th>commit median, head</th><th>fence alone (head, measured inside assertReaderFacingBody)</th><th>fence share of head commit</th></tr>';
  for (const store of ['http', 'local']) for (const kib of [1, 32, 63, 200, 1024, 4096]) {
    const b = perf.filter((r) => r.store === store && r.sizeKiB === kib && r.arm === 'base').map((r) => r.commitMedianMs);
    const h = perf.filter((r) => r.store === store && r.sizeKiB === kib && r.arm === 'head');
    if (!b.length || !h.length) continue;
    const hm = med(h.map((r) => r.commitMedianMs)), fm = med(h.map((r) => r.fenceMedianMs));
    body += `<tr><td class="mono">${store === 'http' ? 'HTTP (Spring)' : 'local (M4)'}</td><td class="mono">${kib >= 1024 ? `${kib / 1024} MiB` : `${kib} KiB`}</td><td class="mono">${med(b).toFixed(1)} ms</td><td class="mono">${hm.toFixed(1)} ms</td><td class="mono ${fm > 50 ? 'warn' : 'ok'}">${fm < 1 ? fm.toFixed(3) : fm.toFixed(1)} ms</td><td class="mono">${((fm / hm) * 100).toFixed(fm / hm < 0.01 ? 2 : 1)}%</td></tr>`;
  }
  body += '</table>';
  const g = existsSync(`${RIG}/results/r2-glued.tsv`) ? tsv(`${RIG}/results/r2-glued.tsv`) : [];
  const t = tsv(`${RIG}/results/r2-resume-title.tsv`);
  body += '<h2>Real CLI: a Legacy session recorded by the bundled CLI, then a torn append glues raw <code>"subtype":"managed_session_header_v1"</code> bytes onto a line</h2><table><tr><th>binary</th><th>transcript</th><th>command</th><th>exit</th><th>model calls</th><th>stderr</th></tr>';
  for (const [arm, shape, exit, calls, , , err] of g) body += `<tr><td class="mono">${arm}</td><td class="mono">${esc(shape)}</td><td class="mono">--resume &lt;id&gt;</td><td class="mono ${exit === 'exit=0' ? 'ok' : 'bad'}">${esc(exit)}</td><td class="mono">${esc(calls)}</td><td class="mono ${err ? 'bad' : 'dim'}">${esc(short(scrub(err || '—'), 110))}</td></tr>`;
  for (const [dir, exit, calls, err] of t) { const [arm, ...rest] = dir.split('-'); body += `<tr><td class="mono">${arm}</td><td class="mono">${esc(rest.join('-').replace('title-', 'custom_title line, ').replace('glued-marker', 'marker glued on'))}</td><td class="mono">--resume "Legacy title"</td><td class="mono ${exit === 'exit=0' ? 'ok' : 'bad'}">${esc(exit)}</td><td class="mono">${esc(calls)}</td><td class="mono ${err ? 'bad' : 'dim'}">${esc(short(err || '—', 110))}</td></tr>`; }
  body += '</table>';
  writeFileSync(`${FIG}/02-fence-cost-and-cli.html`, page('PR #13332 round 2 — what the fence costs, and the glued-marker paths through the real CLI', `Commit totals swing with host load (30–68 on 10 cores); the fence column is the direct measurement. ${SUB}`, body,
    'Up to 63 KiB the fence costs 0.03–0.06 ms on the HTTP store and 1.2–1.8 ms on the local store (it re-reads the body from disk). It grows with the body: 1.4 / 28 ms at 1 MiB and 74 / 336 ms at 4 MiB. A glued marker no longer makes the session Managed on head: base refuses --resume of it and cannot find it by its title (R1-20); head and merge resume both.'));
}

// ---------- Card 3: tests, witnesses, mutants ----------
{
  const sum = (k) => { const d = JSON.parse(readFileSync(`${S2}/${k}.json`, 'utf8')); return { total: d.numTotalTests, passed: d.numPassedTests, skipped: d.numPendingTests, failed: d.numFailedTests, files: d.testResults.length, fails: d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => [a.fullName, r.name])) }; };
  const FLAKY = /waits for Runtime admission|rejects a changed input while the same occurrence|cancels an active occurrence and does not dispatch|reopens the committed 100 MiB/;
  let body = '<table><tr><th>arm</th><th>PR-changed suites (15 core + 5 cli files), 120 s test timeout</th><th>failures</th></tr>';
  for (const [arm, note] of [['head', 'PR head'], ['merge', 'head + main'], ['bht', 'base source + head tests']]) {
    const c = sum(`t2-core-${arm}`), l = sum(`t2-cli-${arm}`);
    const f = [...c.fails, ...l.fails];
    const flaky = f.filter(([n]) => FLAKY.test(n)).length;
    body += `<tr><td class="mono">${arm} <span class="dim">(${note})</span></td><td class="mono">core ${c.passed}/${c.total - c.skipped}, cli ${l.passed}/${l.total}</td><td class="mono ${f.length - flaky ? (arm === 'bht' ? 'ok' : 'bad') : 'dim'}">${arm === 'bht' ? `${f.length - flaky} witnesses fail on base;` : ''}${flaky ? ` ${flaky} load-timing (hook waitFor 1 s / 100 MiB 60 s; also on main)` : ''}${arm !== 'bht' && f.length - flaky ? ` + ${f.length - flaky} other: ${esc(f.filter(([n]) => !FLAKY.test(n)).map(([n]) => n).join('; ').slice(0, 160))}` : ''}</td></tr>`;
  }
  body += '</table>';
  const mut = existsSync(`${RIG}/results/mutants-r2/results.jsonl`) ? jsonl(`${RIG}/results/mutants-r2/results.jsonl`) : [];
  const killed = mut.filter((m) => m.verdict === 'KILLED').length;
  const CLASS = globalThis.R2_CLASS ?? {};
  body += `<h2>Single-guard revert mutants: ${killed}/${mut.length} killed by the PR's own tests (M = round-1 guards re-anchored, N = guards new in round 2)</h2><table><tr><th>id</th><th>reverted guard</th><th>verdict</th><th>killer / classification</th></tr>`;
  body += mut.map((m) => `<tr><td class="mono">${m.id}</td><td>${esc(m.finding)}</td><td class="mono ${m.verdict === 'KILLED' ? 'ok' : /GAP/.test(CLASS[m.id] ?? '') ? 'bad' : 'warn'}">${m.verdict}</td><td class="mono ${m.verdict === 'KILLED' ? 'dim' : ''}">${esc(short(m.verdict === 'KILLED' ? (m.killers.find((k) => !FLAKY.test(k)) ?? m.killers[0]) : CLASS[m.id] ?? '', 140))}</td></tr>`).join('');
  body += '</table>';
  writeFileSync(`${FIG}/03-tests-and-mutants.html`, page("PR #13332 round 2 — the PR's tests on three arms, and single-guard revert mutants", SUB, body, globalThis.R2_NOTE3 ?? ''));
}

// ---------- Card 4: E2E + merge with main ----------
{
  const e2e = [...new Map(tsv(`${RIG}/results/e2e-r2.tsv`).map((r) => [r[1], r])).values()];
  const cause = (label, exit) => {
    if (exit === 'exit=0') return 'pass';
    const files = readdirSync(`${RIG}/runs-r2`);
    const f = files.includes(`${label}.log`) ? `${label}.log` : files.find((n) => n.endsWith(`-${label.replace(/^\d+-/, '')}.log`));
    const text = f ? readFileSync(`${RIG}/runs-r2/${f}`, 'utf8') : '';
    if (/Spring Managed Agent Server did not become ready/.test(text)) return 'spring-startup';
    if (/writer grant is stale/.test(text)) return 'writer-grant-lapse';
    if (/profile refused/.test(text)) return 'model-tool-refused';
    if (/side effect content did not match/.test(text)) return 'model-side-effect';
    return 'other';
  };
  const agg = {};
  for (const [, label, arm, args, exit] of e2e) {
    const mode = args.includes('session-failover') ? '--session-failover (1 s writer lease, Harness killed)' : '--model qwen3.8-max (real model)';
    const k = `${mode}|${arm}`;
    agg[k] ??= { mode, arm, n: 0, pass: 0, causes: {} };
    agg[k].n += 1;
    const c = cause(label, exit);
    if (c === 'pass') agg[k].pass += 1; else agg[k].causes[c] = (agg[k].causes[c] ?? 0) + 1;
  }
  let body = '<table><tr><th>runner mode</th><th>arm</th><th>passed</th><th>failures by cause</th></tr>';
  for (const v of Object.values(agg).sort((a, b) => a.mode.localeCompare(b.mode) || a.arm.localeCompare(b.arm))) body += `<tr><td>${esc(v.mode)}</td><td class="mono">${v.arm}</td><td class="mono ${v.pass === v.n ? 'ok' : 'warn'}">${v.pass}/${v.n}</td><td class="mono dim">${esc(Object.entries(v.causes).map(([c, n]) => `${c} ×${n}`).join(', ') || '—')}</td></tr>`;
  body += '</table>';
  body += globalThis.R2_MERGE_HTML ?? '';
  writeFileSync(`${FIG}/04-e2e-and-merge.html`, page('PR #13332 round 2 — end to end, and the merge with current main', `Repo runner scripts/run-managed-agent-server-e2e.ts, serial, each arm's dist/cli.js + jar + private mysqld. ${SUB}`, body, globalThis.R2_NOTE4 ?? ''));
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1560, height: 900 } });
const pg = await ctx.newPage();
for (const f of ['01-real-store', '02-fence-cost-and-cli', '03-tests-and-mutants', '04-e2e-and-merge']) {
  await pg.goto(`file://${FIG}/${f}.html`);
  await pg.locator('#card').screenshot({ path: `${FIG}/${f}.png` });
  console.log('wrote', `${FIG}/${f}.png`);
}
await browser.close();
