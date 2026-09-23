// Render a scoreboard card (live vs cold replay vs JSONL truth, mutation matrix) to PNG.
const { chromium } = require('playwright');
const fs = require('node:fs');
const steps = require('./out-realmodel/steps.json');
const matrix = JSON.parse(fs.readFileSync(__dirname + '/mutation/matrix.json', 'utf8'));
const truth = JSON.parse(fs.readFileSync(__dirname + '/truth-real.json', 'utf8'));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const needles = ['FIG', 'PRE-FIG', 'MID-FIG', 'POST-FIG', 'PLAIN-FIG', 'R3Q'];
const last = steps.steps.at(-1);
const turnRows = steps.steps.map((s) => `<tr><td>${s.turn}</td><td>${truth.perTurn[s.turn]}</td><td>${truth.perTurn[s.turn] > 10 ? 'shown' : 'hidden'}</td><td class="${s.liveVisible === truth.perTurn[s.turn] > 10 ? 'ok' : 'bad'}">${s.liveVisible ? 'shown' : 'hidden'}</td><td class="${s.coldVisible === truth.perTurn[s.turn] > 10 ? 'ok' : 'bad'}">${s.coldVisible ? 'shown' : 'hidden'}</td></tr>`).join('');
const needleRows = needles.map((n) => {
  const t = truth.at7[n], l = last.live[n].rows.length, c = last.cold[n].rows.length;
  const te = truth.atEnd[n], r = steps.finalReload[n].rows.length;
  return `<tr><td><code>${n}</code></td><td>${t}</td><td class="${l === t ? 'ok' : 'bad'}">${l}</td><td class="${c === t ? 'ok' : 'bad'}">${c}</td><td>${te}</td><td class="${r === te ? 'ok' : 'bad'}">${r}</td></tr>`;
}).join('');
const mRows = matrix.map((m) => `<tr><td>${m.id}</td><td>${m.commit ?? '—'}</td><td>${esc(m.note)}</td><td class="${m.id === 'N0-control' ? (m.failed === 0 ? 'ok' : 'bad') : m.failed > 0 ? 'ok' : 'bad'}">${m.id === 'N0-control' ? `${m.passed}/${m.total} green` : m.failed > 0 ? `killed (${m.failed} red)` : 'SURVIVED'}</td></tr>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.card{padding:22px 26px;width:1100px}h1{font-size:19px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px;color:#9fb3c8}
.sub{color:#8b949e;font-size:12.5px}table{border-collapse:collapse;width:100%;margin-top:4px}
td,th{border:1px solid #30363d;padding:4px 8px;text-align:left;font-size:13px}th{background:#161b22;color:#9fb3c8}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:700}code{font-family:ui-monospace,Menlo,monospace}
.grid{display:grid;grid-template-columns:1fr 1.25fr;gap:18px}</style>
<div class="card"><h1>PR #12234 round 3 — real qwen3.8-max session, real <code>qwen serve</code>, production Web Shell</h1>
<div class="sub">merged tree ${esc(process.env.TREE ?? '')} · session ${steps.sessionId.slice(0, 8)} · every turn typed in the live tab · "cold" = a second browser context opening the same session after each turn · truth = chats/&lt;id&gt;.jsonl</div>
<div class="grid"><div><h2>Search entry vs. persisted message count</h2><table><tr><th>turn</th><th>msgs (JSONL)</th><th>claim (&gt;10)</th><th>live tab</th><th>cold replay</th></tr>${turnRows}</table></div>
<div><h2>Rows per needle vs. JSONL truth</h2><table><tr><th>needle</th><th>truth @7</th><th>live @7</th><th>cold @7</th><th>truth @end</th><th>reload @end</th></tr>${needleRows}</table>
<div class="sub" style="margin-top:6px">second client posts a user message while the dialog is open: live ${steps.foreign.live.rows.length} row, after reload ${steps.foreign.reload.rows.length} row (expected 1)</div></div></div>
<h2>Mutation matrix — fix commits after round 2, PR's own 8 suites</h2><table><tr><th>id</th><th>commit</th><th>mutation</th><th>result</th></tr>${mRows}</table></div>`;
fs.writeFileSync(__dirname + '/scoreboard.html', html);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1152, height: 400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + __dirname + '/scoreboard.html');
  await p.locator('.card').screenshot({ path: __dirname + '/shots/r3-scoreboard.png' });
  await b.close();
})();
