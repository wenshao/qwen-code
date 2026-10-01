// Builds the three evidence cards for PR #13141 from the saved result files and
// renders them with the worktree's Playwright. Usage: node figs.mjs <worktree>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const R = (f) => path.join(SP, 'results', f);
const H = (f) => path.join(SP, 'help', f);
const OUT = path.join(SP, 'figs');
mkdirSync(OUT, { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = (f) => readFileSync(f, 'utf8').split('\n');

const OLD = ['Reserved Broker URL', 'Reserved Broker credential', 'not implemented', 'rejects startup', 'Reserved', 're', 'jects startup.', ' and rejects startup.', 'implemented'];
function mark(line, tone) {
  let s = esc(line);
  if (tone === 'old') {
    s = s.replace(/(Reserved Broker (?:URL|credential)|not implemented|and rejects startup\.|rejects startup\.|jects startup\.|and re$|re$|implemented$)/g, '<b class="old">$1</b>');
  } else if (tone === 'new') {
    s = s.replace(/(Private Broker (?:URL|credential)|required together with|token for Workspace tool turns\.|URL for Workspace tool turns\.|for Workspace tool turns\.|required togethe$|togethe$|r with URL)/g, '<b class="new">$1</b>');
  }
  return s.replace(/(--managed-runtime-broker-(?:url|token))/g, '<span class="opt">$1</span>');
}
function rows(file, startPat, count) {
  const L = lines(file);
  const i = L.findIndex((l) => l.includes(startPat));
  if (i < 0) throw new Error(`${startPat} not in ${file}`);
  return L.slice(i, i + count).map((l) => l.replace(/\s+$/, ''));
}

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mute:#8b949e;--red:#ff7b72;--green:#7ee787;--amber:#e3b341;--blue:#79c0ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg)}
#card{display:inline-block;padding:28px 32px;background:var(--bg);min-width:900px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;color:var(--blue);font-weight:600}
.sub{color:var(--mute);font-size:13px;margin-bottom:6px}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px 14px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
.tag{display:inline-block;font:600 11px/1 ui-monospace,Menlo,monospace;padding:4px 7px;border-radius:4px;margin:10px 0 4px}
.tbase{background:#3d1d1d;color:var(--red)}.tpr{background:#12321c;color:var(--green)}
b.old{color:var(--red);font-weight:600}b.new{color:var(--green);font-weight:600}.opt{color:var(--blue)}
table{border-collapse:collapse;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;width:100%}
td,th{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top}th{background:var(--panel);color:var(--mute);font-weight:600}
.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.mute{color:var(--mute)}
.note{border-left:3px solid var(--green);padding:6px 12px;margin-top:16px;font-size:14px;background:#0f1d14}
.note.amber{border-color:var(--amber);background:#221b0b}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}</div>`;

// ---------- Figure 1: real help output ----------
{
  const pipeBase = rows(H('base-pipe.txt'), '--managed-runtime-broker-url', 2);
  const pipePr = rows(H('pr-pipe.txt'), '--managed-runtime-broker-url', 2);
  const ttyBase = rows(H('base-80.txt'), '--managed-runtime-broker-url', 6);
  const ttyPr = rows(H('pr-80.txt'), '--managed-runtime-broker-url', 8);
  const body = `
<h2>A. <code>qwen serve --help | cat</code> (no TTY: yargs does not wrap)</h2>
<span class="tag tbase">BASE 6310dd38d5</span><pre>${pipeBase.map((l) => mark(l, 'old')).join('\n')}</pre>
<span class="tag tpr">PR HEAD 1e1f1970b3</span><pre>${pipePr.map((l) => mark(l, 'new')).join('\n')}</pre>
<h2>B. <code>qwen serve --help</code> in a real 80-column TTY (tmux pane, captured verbatim)</h2>
<span class="tag tbase">BASE 6310dd38d5</span><pre>${ttyBase.map((l) => mark(l, 'old')).join('\n')}</pre>
<span class="tag tpr">PR HEAD 1e1f1970b3</span><pre>${ttyPr.map((l) => mark(l, 'new')).join('\n')}</pre>
<div class="note">Only these two rows change. At 200 columns both rows also render on one line each (captured; not shown).
The mid-word breaks at 80 columns (<code>hos|ted-harness</code>, <code>re|jects</code>) are yargs' existing hard-wrap and affect every option on base too.</div>`;
  writeFileSync(path.join(OUT, '01-help.html'), page('PR #13141 · qwen serve --help, Broker option rows', 'Real bundle built from each commit with Node 22.23.2 and run through the shipped bin <code>scripts/cli-entry.js</code> (macOS 26, arm64)', body));
}

// ---------- Figure 2: runtime truth matrix + real-stack IT ----------
{
  const pr = JSON.parse(readFileSync(R('runtime-pr.json'), 'utf8'));
  const base = JSON.parse(readFileSync(R('runtime-base.json'), 'utf8'));
  const merge = existsSync(R('runtime-merge.json')) ? JSON.parse(readFileSync(R('runtime-merge.json'), 'utf8')) : undefined;
  const key = (r) => JSON.stringify([r.outcome, r.exitCode, r.message, r.requests.map((q) => [q.toolProfile, q.status, q.code])]);
  const same = (o) => o.results.filter((r, i) => key(r) === key(pr.results[i])).length;
  const short = (p) => p.replace('hosted-workspace-', '').replace('(none: no-tool turn)', 'no-tool');
  const tr = pr.results.map((r) => {
    let res;
    if (r.outcome === 'refused') res = `<span class="bad">startup refused</span> <span class="mute">exit ${r.exitCode}</span><br>${esc(r.message.replace(/^.*\| /, ''))}`;
    else {
      res = `<span class="ok">listening</span><br>` + r.requests.map((q) => {
        const cls = q.code === 'hosted_tool_profile_unavailable' ? 'bad' : 'ok';
        const meaning = q.code === 'hosted_tool_profile_unavailable' ? 'tool gate refuses' : 'passes tool gate';
        return `POST /session ${esc(short(q.toolProfile))} → <span class="${cls}">${q.status} ${esc(q.code)}</span> <span class="mute">(${meaning})</span>`;
      }).join('<br>');
    }
    return `<tr><td>${r.id}</td><td>${esc(r.label)}</td><td>${res}</td></tr>`;
  }).join('');
  const it = JSON.parse(readFileSync(R('it-summary.json'), 'utf8'));
  const itRows = it.map((a) => `<tr><td>${esc(a.tree)}</td><td>${esc(a.entry)}</td><td class="${a.pass ? 'ok' : 'bad'}">${esc(a.tests)}</td><td>${esc(a.observed)}</td></tr>`).join('');
  const body = `
<h2>A. Startup and tool-profile gate — real CLI bundle, one process per row (PR head)</h2>
<table><tr><th>#</th><th>flags (plus the standard hosted-harness options)</th><th>observed</th></tr>${tr}</table>
<div class="sub" style="margin-top:6px">Same 9 rows on the base bundle: ${same(base)}/9 identical${merge ? `; on PR head ⊕ main 0a5f518b4f: ${same(merge)}/9 identical` : ''}. "passes tool gate" = the request got past the Broker check and failed only on the next field this probe left out on purpose (Session Store / MCP list).</div>
<h2>B. HostedPublicWorkspaceIT — Spring + embedded Runtime Broker + H2 + packaged Harness + fixture model</h2>
<table><tr><th>tree</th><th>Harness entry</th><th>result</th><th>observed</th></tr>${itRows}</table>
<div class="note">Each claim in the new help text matches the runtime: scoped to <code>--profile hosted-harness</code> (S6), URL and token required together (S3–S5), and required for Workspace tool turns: file, shell and MCP profiles are refused without them (S1, IT with the flags stripped), while no-tool turns do not need them. The old text ("not implemented and rejects startup") was false on base already (S2 listens on both bundles).</div>`;
  writeFileSync(path.join(OUT, '02-runtime.html'), page('PR #13141 · Does the new help text match runtime behavior?', 'Probe: <code>probe-runtime.mjs</code> (real <code>scripts/cli-entry.js</code>, isolated HOME) · IT: repo test run with <code>-Dqwen.cli.entry</code> pointed at each bundle', body));
}

// ---------- Figure 3: unit test robustness + mutation ----------
{
  const tv = readFileSync(R('test-visible-help.txt'), 'utf8');
  const collapsed = tv.split('COLLAPSED\n')[1].trim();
  const wrapAt = (s, n) => s.match(new RegExp(`.{1,${n}}(\\s|$)`, 'g')).map((x) => x.trimEnd()).join('\n');
  const muts = (label) => readFileSync(R(`mutants-${label}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const a = muts('pr-test'), b = muts('candidate-test');
  const killed = (xs) => xs.filter((x) => x.id !== 'M0' && x.verdict === 'killed').length;
  const mrows = a.map((x, i) => `<tr><td>${x.id}</td><td>${esc(x.what)}</td><td class="${x.id === 'M0' ? (x.verdict === 'survived' ? 'ok' : 'bad') : x.verdict === 'killed' ? 'ok' : 'warn'}">${x.id === 'M0' ? 'passes' : x.verdict}</td><td class="${b[i].id === 'M0' ? (b[i].verdict === 'survived' ? 'ok' : 'bad') : b[i].verdict === 'killed' ? 'ok' : 'warn'}">${b[i].id === 'M0' ? 'passes' : b[i].verdict}</td></tr>`).join('');
  const t = (f) => readFileSync(R(f), 'utf8');
  const tests = (f) => (t(f).match(/^\s*Tests\s{2,}([^\n]+)$/m)?.[1] ?? '?').trim();
  const body = `
<h2>A. What the test's parser actually renders (no <code>.wrap()</code> → yargs default min(80, columns)), whitespace collapsed as the test does</h2>
<pre>${esc(wrapAt(collapsed, 118))}</pre>
<h2>B. Width independence</h2>
<table><colgroup><col style="width:34%"><col style="width:44%"><col></colgroup><tr><th>test version</th><th>environment</th><th>result</th></tr>
<tr><td>5703841150 (first commit, long phrases)</td><td>plain run</td><td class="bad">${esc(tests('unit-first-commit.log'))}</td></tr>
<tr><td>5703841150 (first commit, long phrases)</td><td>real 250-column TTY</td><td class="bad">${esc(tests('unit-first-commit-tty250.log'))}</td></tr>
<tr><td>1e1f1970b3 (head)</td><td>real 40-column TTY · full file</td><td class="ok">${esc(tests('unit-tty-40.log'))}</td></tr>
<tr><td>1e1f1970b3 (head)</td><td>real 250-column TTY · full file</td><td class="ok">${esc(tests('unit-tty-250.log'))}</td></tr>
<tr><td>1e1f1970b3 (head)</td><td>serve + fast-path + hosted-harness-profile + run-qwen-serve</td><td class="ok">${esc(tests('unit-related-pr.log'))}</td></tr>
<tr><td>head ⊕ main 0a5f518b4f</td><td>same 4 files</td><td class="ok">${esc(tests('unit-related-merge.log'))}</td></tr></table>
<h2>C. Mutants of serve.ts against the new test</h2>
<table><tr><th>#</th><th>mutant</th><th>PR test</th><th>candidate test (optional)</th></tr>${mrows}</table>
<div class="note amber">PR test kills ${killed(a)}/9: every realistic revert (M1–M4). It does not pin scope, pairing, row binding, or the absence of "not implemented" (M5–M9).
A whitespace-insensitive exact-row candidate (+16/−6, prettier/eslint clean) kills ${killed(b)}/9. This is optional and does not block the merge.</div>`;
  writeFileSync(path.join(OUT, '03-test.html'), page('PR #13141 · The new unit test: width independence and mutation strength', 'vitest in <code>packages/cli</code>, Node 22.23.2 · the first-commit row replays the triage bot\'s blocker on 5703841150', body));
}

// ---------- render ----------
const require = createRequire(path.join(process.argv[2], 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
const pg = await ctx.newPage();
for (const name of ['01-help', '02-runtime', '03-test']) {
  await pg.goto('file://' + path.join(OUT, `${name}.html`));
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, 'clipped <pre>:', clipped);
}
await browser.close();
