// VERIFICATION RIG ONLY (PR #13354): round-6 figure (head 2c4036c5ea vs main 8505479d87).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13354-rig';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13354-head/package.json');
const { chromium } = require('playwright');
const res = (db, n) => JSON.parse(fs.readFileSync(`${RIG}/results/${db}/${n}.json`, 'utf8'));
const cnt = (r) => `${r.pass}/${r.pass + r.fail}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const css = fs.readFileSync(`${RIG}/fig/figs.mjs`, 'utf8').match(/const css = `([\s\S]*?)`;/)[1].replace('${W}', '1180');
const row = (r, l) => r.rows.find((x) => x.label.includes(l))?.detail ?? {};
const hooks = (d) => (d.hooks ?? []).map((h) => h.split('@')[0]).join(' → ') || '—';
const suite = ['p1-delete', 'p2-edges', 'p5-hooks-basic', 'p3-restart-TERM', 'p4-crash-ABC', 'p9-approval'].map((n) => res('t6', n));
const sp = suite.reduce((a, r) => a + r.pass, 0), sf = suite.reduce((a, r) => a + r.fail, 0);
const f1 = [['Spring TERM restart', res('f6a', 'p5c-h6-TERM')], ['Spring SIGKILL restart', res('f6b', 'p5c-h6-KILL')], ['Harness TERM restart', res('f6c', 'p5c-h6-harness')]];
const f1rows = f1.map(([l, r]) => { const d = row(r, 'delete after'); const c = row(r, 'close after'); return `<tr><td>${l}</td><td class="${r.fail ? 'bad' : 'ok'}">${r.fail ? '✘' : '✔'} delete ${d.row?.state} in ${(d.ms / 1000).toFixed(1)} s, gen ${d.row?.gen}; Hooks: ${hooks(d)}</td><td class="${r.fail ? 'bad' : 'ok'}">${r.fail ? '✘' : '✔'} close ${c.row?.state} in ${(c.ms / 1000).toFixed(1)} s; Hooks: ${hooks(c)}</td></tr>`; }).join('');
const g = res('g6', 'p10-harness-restart');
const grows = g.rows.filter((x) => !x.note).map((x) => `<tr><td>${esc(x.label.replace(/^\[G\d\] /, ''))}</td><td class="${x.ok ? 'ok' : 'bad'}">${x.ok ? '✔' : '✘'} ${x.detail.row ? `${x.detail.row.state}, gen ${x.detail.row.gen}, ${(x.detail.ms / 1000).toFixed(0)} s` : `${x.detail.last?.status ?? ''} ${x.detail.ms ? (x.detail.ms / 1000).toFixed(1) + ' s' : ''}`}</td></tr>`).join('');
const up = res('u6', 'p6-upgrade');
const p8 = (db, name) => { const d = res(db, name); const n = d.N * d.ROUNDS; const done = d.rounds.reduce((a, r) => a + r.completed, 0); return { N: d.N, done, n, wall: d.rounds.map((r) => (r.wall / 1000).toFixed(1)).join(' / '), lock: (d.rounds.reduce((a, r) => a + r.Innodb_row_lock_time, 0) / 1000).toFixed(1), q: Math.round(d.rounds.reduce((a, r) => a + r.Questions, 0) / n) }; };
const crow = [['main <code>8505479d87</code>', 'q8m', '8x3'], ['head <code>2c4036c5ea</code>', 'q8h', '8x3'], ['main', 'q16m', '16x2'], ['head', 'q16h', '16x2'], ['head (host load 47–63)', 'q16h2', '16x2'], ['main (host load 47–63)', 'q16m2', '16x2']].map(([l, db, s]) => { const x = p8(db, `p8-contention-${s}`); return `<tr><td>${l}</td><td class="num">${x.N}</td><td class="${x.done === x.n ? 'ok' : 'bad'}">${x.done === x.n ? '✔' : '✘'} ${x.done}/${x.n}</td><td class="num">${x.wall}</td><td class="num">${x.lock}</td><td class="num">${x.q}</td></tr>`; }).join('');
const body = `
<h2>Regression suite on head (both surfaces): <span class="${sf ? 'bad' : 'ok'}">${sp}/${sp + sf}</span></h2>
<p class="sub">delete 56 · refusals/close/L2/fence/empty 30 · simulated Hook semantics 5 · Spring TERM restart 7 · SIGKILL takeover A/B/C 9 · approval-waiting 4</p>
<h2>F1 / R3-1 — hooked ACTIVE delete / close after a restart (simulated Hook catalog, Harness keeps or loses the attachment)</h2>
<table><tr><th>restart before the operation</th><th>delete</th><th>close</th></tr>${f1rows}</table>
<h2>Harness generation change under a running Spring (G3 integration, no Hook catalog)</h2>
<table><tr><th>scenario</th><th>result</th></tr>${grows}</table>
<h2>Rollout (unchanged behaviour; now documented as Store/coordinator first, Harness second) and upgrade</h2>
<table><tr><th>mix</th><th>result</th></tr>
<tr><td>main Spring + head Harness</td><td class="warn">▲ every Turn (Workspace and private) stays ACCEPTED, prompts 503 <code>hosted_execution_authorization_unavailable</code> — the documented refusal</td></tr>
<tr><td>head Spring + main Harness</td><td class="warn">▲ Turns work; ACTIVE close/delete withdrawn (409 <code>workspace_unavailable</code>) until the Harness is upgraded — documented</td></tr>
<tr><td>upgrade a main database (V47) → head (V48)</td><td class="${up.fail ? 'bad' : 'ok'}">${up.fail ? '✘' : '✔'} ${cnt(up)}: V48 applied; in-flight main CLOSE finishes on protocol 0 (${(row(up, 'in-flight').ms / 1000).toFixed(0)} s); main-created ACTIVE Session deletes on protocol 1</td></tr></table>
<h2>Concurrent Turns in one tenant (4 Workspaces, 4 vCPU)</h2>
<table><tr><th>arm</th><th>N</th><th>completed</th><th>wall per round (s)</th><th>row-lock wait (s)</th><th>SQL statements / Turn</th></tr>${crow}</table>
<div class="note">N=8: both complete; head +10 % statements per Turn and 12.6 s vs 9.2 s row-lock wait. N=16 is not stable on this host: in the first pair head completed with 2.7× main's lock wait; in the second pair (host load 47–63) main itself lost 16/32 Turns while head completed 32/32. No N=16 failure is attributable to the PR.</div>`;
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>PR #13354 round 2 — head <code>2c4036c5ea</code> on the real Linux durable stack</h1><p class="sub">Same rig as round 1 (colima VM, isolated network, durable local-process Broker, packaged Harness, real workers, MySQL 8.4). Control arm: current main <code>8505479d87</code>. The head already contains main up to <code>17347ee0b8</code>; the 3 later main commits merge cleanly.</p>${body}</div>`;
fs.writeFileSync(`${RIG}/fig/04-round2-head-2c4036c.html`, html);
const browser = await chromium.launch();
const p = await (await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1240, height: 1000 } })).newPage();
await p.goto(`file://${RIG}/fig/04-round2-head-2c4036c.html`);
await p.locator('#card').screenshot({ path: `${RIG}/fig/04-round2-head-2c4036c.png` });
await browser.close();
console.log('wrote 04');
