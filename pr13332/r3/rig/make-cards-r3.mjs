// Round-3 evidence cards for PR 13332, rendered from the rig's result files
// (never from hand-typed numbers) and screenshotted with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13332-rig';
const S3 = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332/r3';
const FIG = `${RIG}/fig-r3`;
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
const scrub = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '‹id›').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{0,4}…?/g, '‹id›').replace(/p13332-[a-z-]+-[0-9a-f]{8}/g, '‹session›');
const cell = (s, kind) => `<td class="mono ${kind}">${esc(short(scrub(s)))}</td>`;
const vjson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const cfg = existsSync(`${RIG}/cards-r3.config.mjs`) ? await import(`${RIG}/cards-r3.config.mjs`) : {};
Object.assign(globalThis, cfg.default ?? {});

const SUB = 'base = merge-base 9ec44d45, head = c2c78d6f, merge = head + current main 9763580b (trial merge, no conflicts). Round 3; production code is byte-identical to round 2 (f65ef56a) — only three test files changed.';

// ---------- Card 1: real Session Store on current main ----------
{
  const rows = jsonl(`${RIG}/results-r3/probe.jsonl`);
  const by = (arm, s) => rows.filter((r) => r.arm === arm && r.scenario === s).at(-1);
  const REFUSE = new Set(['sink-turn-result-no-cwd', 'sink-turn-result-other-session', 'turn-settled-null-resultref', 'sink-message-no-cwd', 'sink-compression-no-version', 'refused-body-residue']);
  const wc = (id, t) => (REFUSE.has(id) ? (/^REFUSED|own authority REFUSED/.test(t) ? 'ok' : 'bad') : /REFUSED|DIFFERS|missing/.test(t) || /bound to that rev=[1-9]|"revision":999/.test(t) ? 'bad' : 'ok');
  const pc = (id, arm, t) => (/OK/.test(t) && !/FAILED/.test(t) ? 'ok' : id === 'turn-settled-null-resultref' && arm !== 'base' && /turn\.settled event/.test(t) ? 'warn' : 'bad');
  const G1 = 'new in round 3: multibyte chunk boundaries, main\'s request/tool lifecycle records, residue of a refused body';
  const G2 = 'fence channels (round 2), re-run on current main';
  const G3 = 'round-1 scenarios, re-run on current main';
  const SC = [
    [G1, 'sink-message-multibyte-chunked', '224 000-byte message of "a…u长😀" (parts cut inside code points); text compared byte-for-byte'],
    [G1, 'sink-request-lifecycle', 'ui_telemetry request_lifecycle started/ended + tool_lifecycle, as #13755/#13836 record them'],
    [G1, 'refused-body-residue', '100 KiB message without cwd; Session Store resource rows before/after'],
    [G2, 'sink-message-no-cwd', 'user message without cwd, then a valid follow-up'],
    [G2, 'sink-message-200k-chunked', '200 KiB message (60 KiB parts + manifest)'],
    [G2, 'sink-compression-no-version', 'chat_compression without version'],
    [G3, 'sink-turn-result-no-cwd', 'turn_result without cwd, then a valid follow-up'],
    [G3, 'sink-turn-result-other-session', 'turn_result of another session'],
    [G3, 'turn-settled-null-resultref', 'turn.settled resultRef: null'],
    [G3, 'cancel-real-ref-target', "free-form target = this session's definition ref"],
    [G3, 'domain-record-colliding-keys', 'session_metadata content {revision:999, …}'],
  ];
  let body = '<table><tr><th>scenario</th><th>arm</th><th>write (HTTP store → Spring from the merge jar → MySQL 8.4.7)</th><th>reopen + cold projection</th></tr>';
  let last = '';
  for (const [group, id, label] of SC) {
    if (group !== last) { body += `<tr class="sec"><td colspan="4">${esc(group)}</td></tr>`; last = group; }
    ['base', 'head', 'merge'].forEach((arm, i) => {
      const r = by(arm, id);
      if (!r) throw new Error(`missing ${arm} ${id}`);
      const proj = r.reopen.includes('cold projection') ? r.reopen.slice(r.reopen.indexOf('cold projection')) : r.reopen;
      body += `<tr>${i === 0 ? `<td rowspan="3">${esc(label)}</td>` : ''}<td class="mono">${arm}</td>${cell(r.out, wc(id, r.out))}${cell(proj, pc(id, arm, proj))}</tr>`;
    });
  }
  body += '</table>';
  const loc = jsonl(`${RIG}/results-r3/residue-local.jsonl`);
  body += `<h2>Same refused 100 KiB body on the local store (files under the session's runtime dir)</h2><table><tr><th>arm</th><th>write</th><th>files before → after</th><th>new files</th></tr>${['base', 'head', 'merge'].map((arm) => { const r = loc.filter((x) => x.arm === arm).at(-1); return `<tr><td class="mono">${arm}</td><td class="mono ${/REFUSED/.test(r.out) ? 'ok' : 'bad'}">${esc(short(scrub(r.out), 60))}</td><td class="mono">${r.filesBefore} → ${r.filesAfter}</td><td class="mono ${/REFUSED/.test(r.out) ? 'warn' : 'dim'}">${esc(r.added.map((a) => a.replace(/^resources\/[^/]+\//, '').replace(/\/[0-9a-f-]{36}/, '')).join(', '))}</td></tr>`; }).join('')}</table>`;
  const reg = rows.filter((r) => r.scenario === 'regressed-head');
  body += `<h2>R1-3: MySQL tables restored from a mid-session dump, same writer reads again</h2><table><tr><th>arm</th><th>after the restore</th></tr>${['base', 'head', 'merge'].map((arm) => { const r = reg.filter((x) => x.arm === arm).at(-1); const parts = r.out.split(' || ').slice(3); return `<tr><td class="mono">${arm}</td><td class="mono">${parts.map((x) => `<span class="${/read\(\): RESOLVED/.test(x) ? 'bad' : /read\(\): REJECTED/.test(x) ? 'ok' : 'dim'}">${esc(scrub(x))}</span>`).join('<br>')}</td></tr>`; }).join('')}</table>`;
  writeFileSync(`${FIG}/01-real-store.html`, page('PR #13332 round 3 — real Session Store A/B on current main (Spring + MySQL 8.4.7)', `Each arm's own core dist through openManagedSession + createHttpManagedSessionStores, all against the Spring jar built from the merge tree. ${SUB}`, body,
    'Head and merge give identical outcomes in every scenario. Main\'s lifecycle records pass the fence and come back from both projections; a 224 000-byte multibyte message whose parts split code points comes back byte-identical on all arms. A refused body leaves nothing in the HTTP Session Store (resources are uploaded with the commit), but on the local store its manifest and parts stay on disk (~103 KB here): that store documents orphan reclamation as deliberately absent. Base commits the same body and the session\'s cold projection then fails.'));
}

// ---------- Card 2: tests ----------
{
  const sum = (p) => { const d = vjson(p); return { total: d.numTotalTests, passed: d.numPassedTests, failed: d.numFailedTests, skipped: d.numPendingTests, files: d.testResults.length, fails: d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => [r.name.split('/packages/').at(-1), a.fullName])) , ferr: d.testResults.filter((r) => r.status === 'failed' && !r.assertionResults.some((a) => a.status === 'failed')).map((r) => r.name.split('/packages/').at(-1)) }; };
  const byFile = (s) => { const m = new Map(); for (const [f] of s.fails) m.set(f, (m.get(f) ?? 0) + 1); for (const f of s.ferr) m.set(f, m.get(f) ?? 'file error'); return m; };
  let body = '<h2>Merge damage: whole core and cli suites, merge tree vs main, same host and settings (macOS, default timeouts; 1-min load 59–194 on 10 cores when each suite finished)</h2><table><tr><th>package</th><th>merge</th><th>main</th><th>files failing on merge only</th><th>files failing on both (merge / main tests)</th></tr>';
  for (const pkg of ['core', 'cli']) {
    const m = sum(`${S3}/full-${pkg}-merge.json`), n = sum(`${S3}/full-${pkg}-main.json`);
    const fm = byFile(m), fn = byFile(n);
    const only = [...fm.keys()].filter((f) => !fn.has(f));
    const both = [...fm.keys()].filter((f) => fn.has(f));
    const iso = globalThis.R3_ISO?.[pkg] ?? {};
    body += `<tr><td class="mono">${pkg}</td><td class="mono">${m.passed}/${m.total - m.skipped} (${m.failed} failed)</td><td class="mono">${n.passed}/${n.total - n.skipped} (${n.failed} failed)</td><td class="mono ${only.length ? 'warn' : 'ok'}">${only.length ? only.map((f) => `${esc(f.replace(/^(core|cli)\/src\//, ''))} ×${fm.get(f)}${iso[f] ? ` → ${esc(iso[f])}` : ''}`).join('<br>') : 'none'}</td><td class="mono dim">${both.map((f) => `${esc(f.replace(/^(core|cli)\/src\//, ''))} ${fm.get(f)}/${fn.get(f)}`).join('<br>')}</td></tr>`;
  }
  body += '</table>';
  const tc = sum(`${S3}/t3-core-head.json`), tl = sum(`${S3}/t3-cli-head.json`), ic = sum(`${S3}/iso-core-head.json`);
  const hooks = ['main', 'head'].flatMap((a) => [1, 2, 3].map((i) => [a, i, sum(`${S3}/hook-${a}-${i}.json`)]));
  body += `<h2>The PR's 22 changed test files on head</h2><table><tr><th>run</th><th>result</th></tr>
<tr><td>all 22 files together (15 core + 7 cli)</td><td class="mono">core ${tc.passed}/${tc.total - tc.skipped}, cli ${tl.passed}/${tl.total} — <span class="warn">${tc.failed} core tests at the 15 s timeout, ${tl.failed} hosted-hook-session (1 s waitFor)</span></td></tr>
<tr><td>the 3 core files with failures, alone</td><td class="mono ok">${ic.passed}/${ic.total} pass</td></tr>
<tr><td>hosted-hook-session.test.ts, main and head alternated ×3</td><td class="mono">${hooks.map(([a, i, s]) => `${a}#${i} <span class="${s.failed ? 'warn' : 'ok'}">${s.failed} failed</span>`).join(' · ')} — flips on both</td></tr></table>`;
  const fixed = tsv(`${S3}/loop3.tsv`).filter((r) => r[0] === 'fixed-merge');
  const mut = tsv(`${S3}/loop3b.tsv`).filter((r) => r[0] === 'mutant-fixed');
  const alt = tsv(`${S3}/loop-alt.tsv`);
  const cnt = (rs, v) => rs.filter((r) => r[1] === v);
  const pass = (rs, col = 4) => rs.filter((r) => r[col] === 'casepass=1').length;
  const altP = cnt(alt, 'prefix'), altF = cnt(alt, 'fixed');
  body += `<h2>3048451194 — deflake of "settles a cascade driven only by a hasMeasured transition" (each run is a fresh vitest)</h2><table><tr><th>variant</th><th>case passed</th><th>failure signature</th></tr>
<tr><td>fixed test (debug: true), merge tree</td><td class="mono ok">${pass(fixed)}/${fixed.length}</td><td class="mono dim">—</td></tr>
<tr><td>pre-fix test (3048451194^), alternated with the fixed one</td><td class="mono warn">${pass(altP)}/${altP.length}</td><td class="mono">${esc([...new Set(altP.filter((r) => r[4] !== 'casepass=1').map((r) => r[5]))].join(', '))}</td></tr>
<tr><td>fixed test, same alternation</td><td class="mono ok">${pass(altF)}/${altF.length}</td><td class="mono dim">—</td></tr>
<tr><td>fixed test with ink's guard reverted (<code>return hasChanged || hasMeasuredChanged</code> → <code>return hasChanged</code>)</td><td class="mono ${pass(mut) === 0 ? 'ok' : 'bad'}">${pass(mut)}/${mut.length} (mutant killed ${mut.length - pass(mut)}/${mut.length})</td><td class="mono">Maximum update depth exceeded (React #185) rendered in place of 'fallback'</td></tr></table>`;
  const g = tsv(`${RIG}/results-r3/glued.tsv`);
  const t = tsv(`${RIG}/results-r3/resume-title.tsv`);
  body += '<h2>Real CLI (each arm\'s bundled dist/cli.js): Legacy session with header-marker bytes glued onto a line</h2><table><tr><th>binary</th><th>transcript</th><th>command</th><th>exit</th><th>model calls</th><th>stderr</th></tr>';
  for (const [arm, shape, exit, calls, , , err] of g) body += `<tr><td class="mono">${arm}</td><td class="mono">${esc(shape)}</td><td class="mono">--resume &lt;id&gt;</td><td class="mono ${exit === 'exit=0' ? 'ok' : 'bad'}">${esc(exit)}</td><td class="mono">${esc(calls)}</td><td class="mono ${err ? 'bad' : 'dim'}">${esc(short(scrub(err || '—'), 100))}</td></tr>`;
  for (const [dir, exit, calls, err] of t) { const [arm, ...rest] = dir.split('-'); body += `<tr><td class="mono">${arm}</td><td class="mono">${esc(rest.join('-').replace('title-', 'custom_title line, ').replace('glued-marker', 'marker glued on'))}</td><td class="mono">--resume "Legacy title"</td><td class="mono ${exit === 'exit=0' ? 'ok' : 'bad'}">${esc(exit)}</td><td class="mono">${esc(calls)}</td><td class="mono ${err ? 'bad' : 'dim'}">${esc(short(err || '—', 100))}</td></tr>`; }
  body += '</table>';
  writeFileSync(`${FIG}/02-tests.html`, page('PR #13332 round 3 — merge with current main, the PR\'s tests, and the deflake commit', SUB, body, globalThis.R3_NOTE2 ?? ''));
}

// ---------- Card 3: E2E ----------
{
  const rem = readFileSync(`${RIG}/results-r3/remote-e2e.txt`, 'utf8').split('\n').map((l) => l.match(/^RESULT label=(\S+) arm=(\S+) rc=(\d+) seconds=(\d+) load=(\S+) \S+ \S+ args=(.*)$/)).filter(Boolean);
  const MODES = [['--big-output', '~224 KB multibyte first answer; Harness and Spring killed; the replacement\'s second Turn must restore it; both answers checked in MySQL'], ['--session-failover', 'Harness and Spring killed after turn 1 (1 s writer lease); the replacement restores the context'], ['--inflight-failover', 'Harness and Spring\'s process tree killed while the tool execution is held at the Runtime start (PREPARED); the replacement reclaims the durable local Worker and runs the tool once (Linux-only)'], ['--continuation-failover', 'killed after the tool settled, mid continuation text; recovered without replaying the prompt or the tool (Linux-only)']];
  let body = '<h2>Deterministic runner modes on Linux (aarch64, e2e image, MySQL 8.0.46, --network none, --cpus 4; 1-min host load ≤ 3.4)</h2><table><tr><th>mode</th><th>what it checks</th><th>base</th><th>head</th><th>merge</th></tr>';
  for (const [mode, what] of MODES) {
    body += `<tr><td class="mono">${mode}</td><td>${esc(what)}</td>${['base', 'head', 'merge'].map((arm) => { const rs = rem.filter((m) => m[2] === arm && m[6].trim() === mode); const ok = rs.filter((m) => m[3] === '0').length; return `<td class="mono ${ok === rs.length && rs.length ? 'ok' : 'bad'}">${ok}/${rs.length} <span class="dim">(${rs.map((m) => `${m[4]}s`).join(' ')})</span></td>`; }).join('')}</tr>`;
  }
  body += '</table>';
  const rm = tsv(`${RIG}/results/e2e-r3.tsv`);
  body += '<h2>Real model on macOS (qwen3.8-max, Harness + Spring + private MySQL 8.4.7)</h2><table><tr><th>arm</th><th>passed</th><th>runs</th></tr>';
  for (const arm of ['head', 'merge']) { const rs = rm.filter((r) => r[2] === arm); const ok = rs.filter((r) => r[4] === 'exit=0').length; body += `<tr><td class="mono">${arm}</td><td class="mono ${ok === rs.length ? 'ok' : 'warn'}">${ok}/${rs.length}</td><td class="mono dim">${rs.map((r) => `${r[1]} ${r[5]}`).join(' · ')}</td></tr>`; }
  body += '</table>';
  writeFileSync(`${FIG}/03-e2e.html`, page('PR #13332 round 3 — end to end through the repo runner', `scripts/run-managed-agent-server-e2e.ts from each arm (its own dist/cli.js and jar). Linux trees were built inside the image from the same commits. ${SUB}`, body, globalThis.R3_NOTE3 ?? ''));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1560, height: 900 } });
const pg = await ctx.newPage();
for (const f of ['01-real-store', '02-tests', '03-e2e']) {
  await pg.goto(`file://${FIG}/${f}.html`);
  await pg.locator('#card').screenshot({ path: `${FIG}/${f}.png` });
  console.log('wrote', `${FIG}/${f}.png`);
}
await browser.close();
