// Builds the evidence cards for the PR #12863 report from the recorded
// results and renders each with the repo's Playwright at 2x.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const SP = path.resolve(import.meta.dirname, '..');
const OUT = path.join(SP, 'shots');
const W = path.join(SP, 'wt-pr');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- data ----------------------------------------------------------------
const FIX = 'packages/core/src/managed-runtime/contracts/managed-extension-record-v1.fixtures.json';
const before = JSON.parse(execFileSync('git', ['show', `c3e880b842:${FIX}`], { cwd: W, maxBuffer: 1 << 30 }));
const after = JSON.parse(fs.readFileSync(path.join(W, FIX), 'utf8'));
const newIds = new Set(['reattach-clears-runtime']);
for (const k of Object.keys(after)) {
  if (!Array.isArray(after[k]) || k === 'domains') continue;
  const old = new Set(before[k].map((c) => c.id));
  for (const c of after[k]) if (!old.has(c.id)) newIds.add(c.id);
}
const allIds = [...new Set(Object.values(after).filter(Array.isArray).flat().map((c) => c?.id).filter((i) => typeof i === "string"))];
const rows = fs.readFileSync(path.join(SP, 'mut/out/results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const by = new Map();
for (const r of rows) {
  if (r.id === 'baseline') continue;
  const key = `${r.lang}:${r.id}`;
  if (!by.has(key)) by.set(key, { id: r.id, lang: r.lang, gap: r.gap });
  by.get(key)[r.arm] = r;
}
function cases(r) {
  const out = [];
  for (const f of r.failed) {
    const ts = /'([^']+)'/.exec(f);
    if (ts) {
      // Vitest shortens long ids in titles; resolve a shortened id by prefix.
      const name = ts[1].endsWith('…') ? allIds.find((i) => i.startsWith(ts[1].slice(0, -1))) ?? ts[1] : ts[1];
      out.push(name);
      continue;
    }
    const java = [...f.matchAll(/[A-Za-z]+Cases\/([A-Za-z0-9-]+)/g)].map((m) => m[1]);
    if (java.length) out.push(...java);
    else out.push(f.replace(/ \[.*$/, ''));
  }
  return [...new Set(out)];
}
const verdict = (r) => (r.failed.length ? 'killed' : 'survives');
const sections = [
  ['Survived both suites in the #12837 verification (#12846 items)', ['T1', 'T2', 'T3', 'T4', 'T5', 'J1', 'J2', 'J3', 'J4']],
  ['Other new cases (audit rounds)', ['T6', 'T8', 'T9', 'T10', 'T11b', 'T12', 'T15-strict', 'T18-strict', 'J5b', 'J6-strict', 'J7-strict', 'J8-strict', 'J9-strict', 'J10', 'J11', 'J12', 'J13', 'J14', 'J15', 'J16', 'J17', 'J18', 'J19b', 'J20', 'J21', 'J22', 'J23', 'J24', 'J25', 'J26', 'J27-strict', 'J28-strict']],
  ['Controls: not isolating, or equivalent as the PR states', ['T7', 'T11', 'J19', 'J5', 'T13', 'T14', 'T16-eq', 'T17-eq']],
  ['Sample of the gaps the audit record defers (expected to survive)', ['D1-ts', 'D2-ts', 'D1-java', 'D3-java', 'D4-java']],
];
const find = (id) => [...by.values()].find((m) => m.id === id);

// ---- card 1: mutation matrix ---------------------------------------------
let isolating = 0;
let total = 0;
let deferred = 0;
let body = '';
for (const [title, ids] of sections) {
  body += `<tr class="sec"><td colspan="5">${esc(title)}</td></tr>`;
  for (const id of ids) {
    const m = find(id);
    if (!m) throw new Error(`missing ${id}`);
    if (id.startsWith('D')) deferred++; else total++;
    const iso = !m.main.failed.length && m.pr.failed.length;
    if (iso) isolating++;
    const caught = m.pr.failed.length ? cases(m.pr) : [];
    const shown = caught.slice(0, 3).map((c) => (newIds.has(c) ? `<b class="new">${esc(c)}</b>` : `<span class="old">${esc(c)}</span>`)).join(', ') + (caught.length > 3 ? ` <span class="old">+${caught.length - 3} more</span>` : '');
    const mainNote = m.main.failed.length ? ` <span class="old">(${esc(cases(m.main).slice(0, 1).join(''))}${m.main.failed.length > 1 ? ', …' : ''})</span>` : '';
    body += `<tr><td class="id">${esc(m.id)}</td><td>${m.lang === 'ts' ? 'TS' : 'Java'} · ${esc(m.gap.replace(/^#12846: /, ''))}</td>`
      + `<td class="main-${verdict(m.main)}">${verdict(m.main)}${mainNote}</td><td class="pr-${verdict(m.pr)}">${verdict(m.pr)}</td><td>${shown || '<span class="old">—</span>'}</td></tr>`;
  }
}
const card1 = `<div id="card"><h1>PR #12863 · fixture A/B under clause-level mutants</h1>
<div class="sub">One source tree (unchanged since #12837). Arm <b>main</b> = fixtures + test file at c3e880b842; arm <b>PR</b> = 93343ac9f9. Each mutant weakens (or, *-strict, tightens) one check.
TS: the two focused Vitest files (610 → 644 tests). Java: ManagedExtensionRecordContractTest via surefire (7 tests). <b class="new">green</b> = a case this PR adds or rewrites.</div>
<table><tr class="hd"><th>Mutant</th><th>What it changes</th><th>main fixtures</th><th>PR fixtures</th><th>Caught by (PR arm)</th></tr>${body}</table>
<div class="note"><b>${isolating} of the ${total}</b> targeted mutants survive main's fixtures and are killed by the PR's, each only by its own new or rewritten case(s); the ${deferred} deferred-gap mutants survive both arms, as the audit record says. Every new or rewritten case kills at least one of them except <code>rebuilds-after-a-proven-end</code>, which two rules decide (as the audit record notes). Class file restored to its baseline SHA after the Java runs; worktree clean.</div></div>`;

// ---- card 2: authority probe ---------------------------------------------
const probe = (f) => JSON.parse(fs.readFileSync(path.join(SP, 'probe', f), 'utf8'));
const cols = [['before #12837 · 88d881491b', probe('probe-pre12837.txt')], ['PR head (= main c3e880b842)', probe('probe-pr.txt')], ['trial merge with H0c #12855', probe('probe-merge.txt')]];
const steps = [
  ['2 commitDomainRecord(monitor_run)', 'commitDomainRecord · monitor_run'],
  ['3 appendExecution(monitor_run, harness)', 'appendExecution · monitor_run · harness'],
  ['4 appendExecution(monitor_run, trusted_entry)', 'appendExecution · monitor_run · trusted_entry'],
  ['5 appendExecutionEvent(monitor_run, trusted_entry)', 'appendExecutionEvent · monitor_run · trusted_entry'],
  ['6 appendExecution(team_state, trusted_entry)', 'appendExecution · team_state (disabled) · trusted_entry'],
  ['7 re-open (replay)', 're-open the Session (replay)'],
];
const cell = (v) => {
  if (!v) return '<td>—</td>';
  const refused = v.startsWith('REFUSED');
  const short = v.replace(/^REFUSED \w+: /, '').replace(/payload\.domain must be one of: .*$/, 'payload.domain must be one of: … (32 names, no monitor_run)').replace(/^OPENED, domain events: /, 'opened; events: ');
  const cls = refused ? 'ref' : 'acc';
  return `<td class="${cls}">${refused ? 'refused' : v.startsWith('OPENED') ? 'opened' : 'accepted'}<div class="small">${esc(short.replace(/^ACCEPTED /, ''))}</div></td>`;
};
let t2 = `<tr class="hd"><th>Real LocalManagedSessionAuthority call</th>${cols.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr>`;
for (const [key, label] of steps) t2 += `<tr><td class="id">${esc(label)}</td>${cols.map(([, p]) => cell(p[key])).join('')}</tr>`;
const card2 = `<div id="card"><h1>Authority probe · the rewritten acceptance criterion and Decision 1</h1>
<div class="sub">Built core dist of each tree; a real journal in a temp dir. Step 1 (control) commits session_metadata in every column. Events are hand-built domain.committed records whose recordRef is published as managed-&lt;domain&gt;.</div>
<table>${t2}</table>
<div class="note">Matches the PR's new text: only <code>commitDomainRecord</code> checks enablement; the generic append paths (trusted_entry) and replay take a <code>monitor_run</code> event, which they refused before #12837. H0c (#12855) closes the generic paths for <code>monitor_run</code>, but <code>team_state</code> (any disabled domain) still passes — the PR's wording asks for the check on <i>every</i> path that commits domain records.</div></div>`;

// ---- card 3: cross-PR Broker cancel mapping --------------------------------
const cancel = fs.readFileSync(path.join(SP, 'probe/cancel-mapping.txt'), 'utf8').trimEnd();
const card3 = `<div id="card"><h1>Cross-PR check · Broker cancel → H0c mapping → H0b contract</h1>
<div class="sub">Trial merge of #12855 (34e32da78c) + #12863. Real InMemoryToolExecutionRepository, H0c's ManagedExtensionProjection.executionOf, and ManagedExtensionRecords from the same classpath (JDK 21).</div>
<pre>${esc(cancel).replace(/= false/g, '= <span class="k">false</span>').replace(/= true/g, '= <span class="s">true</span>')}</pre>
<div class="note">This PR's corrected paragraph says a never-sent cancel maps to <code>not_started_proven</code>, a sent one to <code>settled</code>, and H0c must tell them apart. #12855 Decision 10 and its fixtures (<code>brokerExecutionCases/settled-cancelled</code>, <code>inspectionExecutionCases/settled-cancelled</code>) map every cancelled record to <code>settled</code>, so a never-sent cancel takes <code>intent → settled</code>, which the contract refuses. Neither <code>executionOf</code> nor <code>extensionExecutionOf</code> has a production caller yet, so nothing fails at runtime today.</div></div>`;

// ---- render ----------------------------------------------------------------
const css = `body{margin:0;background:#0d1117;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{width:1240px;padding:22px 26px;background:#0d1117}
h1{font-size:20px;margin:0 0 6px;color:#f0f6fc} .sub{color:#8b949e;font-size:12.5px;margin-bottom:12px}
table{border-collapse:collapse;width:100%;font-size:12.5px} th,td{border:1px solid #30363d;padding:4px 7px;vertical-align:top;text-align:left}
tr.hd th{background:#161b22;color:#c9d1d9} tr.sec td{background:#1f2937;color:#79c0ff;font-weight:600}
td.id{font-family:ui-monospace,Menlo,monospace;white-space:nowrap;color:#d2a8ff}
td.main-survives,td.pr-survives,td.acc{color:#e3b341;font-weight:600} td.main-killed{color:#8b949e;font-weight:600} td.pr-killed{color:#7ee787;font-weight:600} td.ref{color:#79c0ff;font-weight:600}
b.new{color:#7ee787;font-family:ui-monospace,Menlo,monospace;font-weight:600} span.old{color:#8b949e;font-family:ui-monospace,Menlo,monospace}
.small{font-weight:400;color:#8b949e;font-size:11.5px;font-family:ui-monospace,Menlo,monospace}
.note{margin-top:12px;border-left:3px solid #d29922;padding:6px 10px;background:#161b22;color:#e6edf3;font-size:13px}
code{font-family:ui-monospace,Menlo,monospace;color:#ffa657}
pre{font:13px/1.5 ui-monospace,Menlo,monospace;background:#161b22;border:1px solid #30363d;padding:12px;margin:0;white-space:pre;overflow:hidden}
.k{color:#ff7b72;font-weight:700}.s{color:#7ee787;font-weight:700}`;
// In the matrix, "killed" is the desired outcome only in the PR arm; colour
// it neutral-positive there by swapping classes for arm columns.
const html = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${inner}</body></html>`;
const cards = [['01-mutation-ab.png', card1], ['02-authority-probe.png', card2], ['03-cancel-mapping.png', card3]];
const require = createRequire(path.join(W, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1300, height: 900 } });
for (const [name, inner] of cards) {
  const file = path.join(OUT, name.replace('.png', '.html'));
  fs.writeFileSync(file, html(inner));
  await page.goto('file://' + file);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre,td,th')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await page.locator('#card').screenshot({ path: path.join(OUT, name) });
  console.log(name, 'clipped elements:', clipped);
}
await browser.close();
