// Builds fig/f1..f4.html from the measured JSON and screenshots each .card to PNG.
import fs from 'node:fs';
import { chromium } from '/Users/wenshao/git/v12784/merged/node_modules/playwright/index.mjs';
const V = '/Users/wenshao/git/v12784';
const J = (f) => JSON.parse(fs.readFileSync(`${V}/${f}`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (x) => Number(x).toLocaleString('en-US');
fs.mkdirSync(`${V}/fig`, { recursive: true });
const css = `
*{box-sizing:border-box} body{margin:0;background:#eef1f5;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
.card{width:1180px;margin:16px;background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:20px 24px}
h1{font-size:19px;margin:0 0 4px} .sub{color:#59636e;font-size:12.5px;margin-bottom:14px}
h2{font-size:14.5px;margin:16px 0 6px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:4px 0}
th,td{border:1px solid #d0d7de;padding:5px 8px;text-align:left;vertical-align:top} th{background:#f6f8fa;font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.del{background:#ffebe9;border-left:3px solid #cf222e;padding:4px 8px;margin:2px 0;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:11.8px}
.add{background:#dafbe1;border-left:3px solid #1a7f37;padding:4px 8px;margin:2px 0 8px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:11.8px}
.ok{color:#1a7f37;font-weight:600} .bad{color:#cf222e;font-weight:600} .warn{background:#fff8c5}
.note{color:#59636e;font-size:12.5px;margin-top:10px} .pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.pg{background:#dafbe1;color:#1a7f37} .pr{background:#ffebe9;color:#cf222e} .py{background:#fff8c5;color:#7d4e00}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}</div></body></html>`;
const SUB = 'base = origin/main <b>34ad20a</b> · head = 34ad20a + PR head <b>f4244f9</b> (merge tree d24939a) · both built from source (pnpm install → build → bundle) on macOS, Node 24.18.1';

// ---------- F1: wire ----------
const wire = J('wire-summary.json');
const b1 = fs.readFileSync(`${V}/wire-smoke-qwen3-base-t1-1.md`, 'utf8').split('\n');
const h1 = fs.readFileSync(`${V}/wire-smoke-qwen3-head-t1-1.md`, 'utf8').split('\n');
const rem = b1.filter((l) => !h1.includes(l)), add = h1.filter((l) => !b1.includes(l));
let diff = '';
for (let i = 0; i < rem.length; i++) diff += `<div class="del">− ${esc(rem[i])}</div><div class="add">+ ${esc(add[i])}</div>`;
const wrows = wire.map((w) => `<tr><td>${w.model}</td><td>${w.todo_write ? 'on' : 'off'}</td><td class="num">${n(w.chars[0])} → ${n(w.chars[1])}</td><td class="num">${w.chars[1] - w.chars[0]}</td><td class="num">${n(w.prompt_tokens[0])} → ${n(w.prompt_tokens[1])}</td><td class="num"><b>${w.prompt_tokens[2]}</b></td><td>${w.sameTools ? 'identical' : 'DIFFERENT'}</td><td>${w.removed.length}</td></tr>`).join('');
fs.writeFileSync(`${V}/fig/f1.html`, page('F1 · What the real CLI sends: the main-session system prompt on the wire',
  `${SUB}<br>Real <code>dist/cli.js</code> headless run → logging proxy → DashScope. Isolated QWEN_HOME, <code>tools.todoWrite.enabled=true</code>, prompt "reply with the single word ok". Run-specific paths normalised before diffing.`,
  `<h2>Every line that differs between the two requests (qwen3.8-max, todo on)</h2>${diff}
  <h2>Request size, same input on both arms</h2>
  <table><tr><th>model</th><th>todo</th><th class="num">system prompt chars</th><th class="num">Δ chars</th><th class="num">provider-billed prompt_tokens</th><th class="num">Δ tokens</th><th>tools array</th><th>lines changed</th></tr>${wrows}</table>
  <div class="note">Bundle check: of 616 <code>dist/chunks</code> files, after normalising content-hash chunk names only two differ: the prompts chunk (86,699 → 86,257 bytes) and the git-commit stamp. <code>dist/cli.js</code> is identical. The provider's own tokenizer shows −25 / −73 tokens, in line with the PR's o200k figures (−25 / −74).</div>`));

// ---------- F2: matrix ----------
const ra = J('render-analysis.json');
const claimed = { 'general (interactive)': [3772, 3747, '0.66%'], 'general + todo': [4075, 4001, '1.82%'], 'qwen-coder + todo': [4300, 4226, '1.72%'], 'qwen-vl + todo': [4254, 4180, '1.74%'], 'gemma4 + todo': [4257, 4183, '1.73%'], 'CodeModeOnly + todo': [4302, 4228, '1.72%'] };
const trows = ra.tokens.map((t) => { const c = claimed[t.variant]; const same = c[0] === t.before && c[1] === t.after; const pctSame = c[2] === t.pct; return `<tr><td>${t.variant}</td><td class="num">${n(c[0])} → ${n(c[1])} (${c[2]})</td><td class="num">${n(t.before)} → ${n(t.after)} (<span class="${pctSame ? '' : 'warn'}">${t.pct}</span>)</td><td>${same ? '<span class="ok">✓ exact</span>' : '<span class="bad">✗</span>'}${pctSame ? '' : ' · % rounds to ' + t.pct}</td></tr>`; }).join('');
const shapes = Object.entries(ra.shapes).map(([k, v]) => `<tr><td class="mono">${k.replace(/\+/g, ' + ')}</td><td class="num">${v}</td></tr>`).join('');
fs.writeFileSync(`${V}/fig/f2.html`, page('F2 · Render matrix, declared-tool gating, and size claims',
  `${SUB}<br>384 renders per arm from the built <code>packages/core/dist</code>: 4 model families × 3 modes × todo on/off × code-mode on/off × 4 declared-tool surfaces × 2 output styles (with / without coding instructions). Rendered from a git cwd.`,
  `<div class="grid"><div><h2>Which lines changed, per render (base → head)</h2><table><tr><th>changed lines</th><th class="num">renders</th></tr>${shapes}<tr><td>any other line / line-count change</td><td class="num"><b>0</b></td></tr></table>
  <div class="note">"Comments + Plan + Adapt" (12): direct convention with <code>todo_write</code> undeclared, where the gate drops the Task Management bullet in both arms.</div></div>
  <div><h2>Structural checks</h2><table>
  <tr><td>Gating drops the same lines in both arms</td><td class="num"><span class="ok">${ra.gating.sameDroppedLines}/${ra.gating.compared}</span></td></tr>
  <tr><td>Pointer "'# Task Management' governs its use" present without the section</td><td class="num"><span class="ok">0/384</span></td></tr>
  <tr><td>Section still carries: short+outcome-oriented · not for simple/single-step · keep current &amp; revise on scope change · benefits from explicit tracking</td><td class="num"><span class="ok">192/192</span></td></tr>
  <tr><td>"outcome-oriented" / "simple or single-step" occurrences (todo on)</td><td class="num">3→1 / 2→1</td></tr></table></div></div>
  <h2>PR body token table (o200k_base, interactive, git on, no sandbox/style/context)</h2>
  <table><tr><th>variant</th><th class="num">PR claims</th><th class="num">reproduced from dist</th><th>match</th></tr>${trows}</table>
  <h2>docs/verification/resident-tool-prompt-assembly/README.md (not touched by the PR), reproduced on both builds</h2>
  <table><tr><th></th><th class="num">Task Management line</th><th class="num">todo on: no snapshot → file-7 allowlist</th><th class="num">todo on: monitor undeclared → file-7</th><th class="num">todo off (both)</th></tr>
  <tr><td>doc says (lines 43, 71, 158)</td><td class="num">228 chars</td><td class="num">1,364 / 1,368 B</td><td class="num">1,047 / 1,051 B</td><td class="num">1,135 / 818</td></tr>
  <tr><td>base build</td><td class="num">228</td><td class="num">1,364 / 1,368</td><td class="num">1,047 / 1,051</td><td class="num">1,135 / 818</td></tr>
  <tr class="warn"><td>head build</td><td class="num"><b>126</b></td><td class="num"><b>1,262 / 1,266</b></td><td class="num"><b>945 / 949</b></td><td class="num">1,135 / 818</td></tr></table>`));

// ---------- F3: mutation ----------
const m0 = J('mutation-results.json'), m1 = J('mutation-results-with-patch.json');
const mrows = m0.map((m, i) => { const a = m.failed > 0, b = m1[i].failed > 0; return `<tr class="${a ? '' : 'warn'}"><td>${esc(m.name)}</td><td class="num">${a ? `<span class="pill pg">killed (${m.failed})</span>` : '<span class="pill py">survives</span>'}</td><td class="num">${b ? `<span class="pill pg">killed (${m1[i].failed})</span>` : '<span class="pill py">survives</span>'}</td></tr>`; }).join('');
const patch = fs.readFileSync(`${V}/suggested-test.patch`, 'utf8').split('\n').filter((l) => /^[+ ]/.test(l) && !l.startsWith('+++')).slice(0, 9).map((l) => `<div class="${l.startsWith('+') ? 'add' : 'mono'}" style="margin:0;white-space:pre">${esc(l)}</div>`).join('');
fs.writeFileSync(`${V}/fig/f3.html`, page('F3 · Mutation matrix on prompts.ts (head tree, prompts.test.ts, 197 tests)',
  `${SUB}<br>One mutation at a time, restored from a byte copy after each; every mutation self-checks that it changed the file. Working tree clean afterwards.`,
  `<table><tr><th>mutation</th><th class="num">as submitted</th><th class="num">+ 3-line test addition</th></tr>${mrows}</table>
  <h2>Why M7/M8 survive</h2><div class="note" style="color:#1f2328">All 17 snapshots are todo-off renders, and the todo-on text is guarded only by <code>toContain</code> assertions. M7 deletes the rule that is now the only home of the Adapt sentence this PR removes. M8 predates this PR, but the PR description lists it among the rules the section carries.</div>
  <h2>Suggested addition to "states the todo usage rules once…" (suite still 197/197, Prettier/ESLint clean)</h2>${patch}`));

// ---------- F4: A/B ----------
const ab = J('ab-table.json'), rows = J('ab-rows.json');
const tname = { simple: 'simple — one-line edit (todo on)', multi: 'multi — 4-part change (todo on)', big: 'big — 6-part request (todo on)', comments: 'comments — refactor + NaN guard (todo off)', tz: 'tz — time-zone feature + tests (todo off)' };
const cell = (x, k) => (k === 'todoRuns' ? `${x.todoRuns}/${x.n}` : k === 'comment' ? `${x.commentRuns}/${x.n} <span class="mono">(${x.commentLines} ln)</span>` : `${x.pass}/${x.n}`);
const arows = ab.map((c) => `<tr><td>${tname[c.task]}</td><td>${c.fam === 'qwen3' ? 'qwen3.8-max' : 'deepseek-v4.1-flash'}</td>${['todoRuns', 'comment', 'pass'].map((k) => `<td class="num">${cell(c.base, k)}</td><td class="num">${cell(c.head, k)}</td>`).join('')}</tr>`).join('');
const clist = rows.filter((r) => r.comments.length).map((r) => r.comments.map((c) => `<tr><td class="mono">${r.arm}</td><td class="mono">${r.id.replace(/-t\d-/, ' #')}</td><td class="mono">${esc(c)}</td></tr>`).join('')).join('');
fs.writeFileSync(`${V}/fig/f4.html`, page('F4 · Real-model behavioural A/B: 120 headless runs of the real bundle',
  `${SUB}<br>Same fixture repo, same prompt, arms interleaved in time; default approval with an allow-list (read/edit tools, todo_write, the fixture's npm scripts). Outcome = run succeeded + independent re-run of <code>npm run check</code> + a behaviour probe of the edited module.`,
  `<table><tr><th rowspan="2">task</th><th rowspan="2">model</th><th colspan="2" class="num">runs using todo_write</th><th colspan="2" class="num">runs adding comments</th><th colspan="2" class="num">outcome pass</th></tr>
  <tr><th class="num">base</th><th class="num">head</th><th class="num">base</th><th class="num">head</th><th class="num">base</th><th class="num">head</th></tr>${arows}
  <tr><th colspan="2">total</th><th class="num">4/60</th><th class="num">5/60</th><th class="num">3/60 (4 ln)</th><th class="num">4/60 (6 ln)</th><th class="num">60/60</th><th class="num">60/60</th></tr></table>
  <h2>Every comment line added in all 120 runs: all state a why (hidden constraint); none narrates the change or addresses the user</h2>
  <table><tr><th>arm</th><th>run</th><th>added line</th></tr>${clist}</table>
  <div class="note">Todo runs (9): every list had 5 items and at most one in_progress; none repeated the list in the final answer. One run per arm ended with "verify" still pending. In both, my allow-list denied the compound shell command, and the model said so in its answer. N=6 per cell: this rules out a gross regression, not a small shift.</div>`));

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1240, height: 600 }, deviceScaleFactor: 2 });
for (const f of ['f1', 'f2', 'f3', 'f4']) {
  await p.goto(`file://${V}/fig/${f}.html`);
  await (await p.$('.card')).screenshot({ path: `${V}/fig/${f}.png` });
}
await b.close();
console.log('ok');
