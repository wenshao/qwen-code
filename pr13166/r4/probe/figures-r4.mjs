// VERIFICATION RIG ONLY (PR #13166 round 4): evidence figures from the round-2 scenario logs.
// Every quoted line is copied from out/<db>/*.log (see the assets README).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13166-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig-r4`;
fs.mkdirSync(OUT, { recursive: true });
const W = 980;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:24px 28px 26px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  h2{font-size:14.5px;margin:16px 0 8px}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.6px;line-height:1.45;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:9px 11px;margin:0 0 10px;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin:4px 0 12px;line-height:1.5;background:#161b22}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}.note.info{border-left-color:#58a6ff}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.8px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin-bottom:12px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}.dim{color:#8b949e}
  .g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const P = (t) => ({ c: 'pass', t });
const F = (t) => ({ c: 'fail', t });
const A = (t) => ({ c: 'amber', t });
const pre = (lines) => `<pre>${lines.join('\n')}</pre>`;
const log = (db, f) => fs.readFileSync(`${RIG}/out/${db}/${f}`, 'utf8').split('\n');
const pick = (db, f, re, n = 99, width = 160) => log(db, f).filter((l) => re.test(l)).slice(0, n).map((l) => esc(l.length > width ? l.slice(0, width) + ' …' : l));
const tag = (t, cls) => `<span class="${cls}">${t}</span>`;

const figs = {};
figs['r4-01-holds'] = page(
  'Round 4 at 6b86c46c: what the real stack shows',
  'Same rig; deps reinstalled from the new lockfile; Harness, Runtime worker and server jar rebuilt (main was merged, Java changed). The two Linux-only Broker defaults from #13211 are set false on this macOS host. Host load 110–220 during the run.',
  table(
    ['Item', 'Real stack at 6b86c46c', 'Reading'],
    [
      ['R4-3 brace budget (64 alternatives)', P('<code>{a,b}</code>×6 and <code>{1..64}</code> run; ×7, <code>{1..65}</code>, <code>{1..20000}</code>, nested ×14 refused before acquisition, message names the limit'), P('fixed')],
      ['R4-7 recovered glob result', P('A killed after the Broker accepted <code>:start</code>; B\'s recovery commits 64,957 B, 78/100 paths + hint; Turn completes, lease free'), P('fixed')],
      ['R4-10 resolution errors', P('<code>package.json/main</code> → “Path could not be resolved (ENOTDIR)”, loop → “(ELOOP)”; no host path'), P('fixed')],
      ['R6-1 escaped spellings', P('<code>pe\\ek/secret.txt</code>, <code>peek/secret\\.txt</code> refused by the Harness before acquisition (0 prepared)'), A('not reachable through the Harness; worker fix is defence in depth')],
      ['R4-2 sibling check', A('read through <code>peek</code> still returns the active sibling\'s file'), A('documented as worker-local, not a confidentiality guarantee')],
      ['glob through an outward link', A('<code>peek/**/*</code> now answers “No files found” (walk contained) instead of an error'), 'change, contained'],
      ['Regression: S1 12/12 · S2 20/20 · S4 8/8 · S5 3/3 · S6 4/4 · S9 2/2 + 2/2', '—', P('unchanged')],
    ],
  ) + pre(pick('g12b', 's20-recover-trunc-head4.log', /^\[(A\]|takeover load on B|recovered tool result|terminal|model saw)/, 5, 200)),
);
figs['r4-02-matcher'] = page(
  'The pattern-cost class is still open: the matcher, not the expansion',
  'minimatch compiles extglob groups and star chains to backtracking regexes; the cost grows with the file name. Neither shape uses a brace, so the new 64-alternative gate admits both. Ordinary names only in these Sessions (package-lock.json, a 32-character .ts file).',
  '<h2>6b86c46c</h2>' +
    pre([...pick('g12b', 's19-r4-head4-extglob.log', /^\[(extglob3|extglob3 next Turn|extglob3 harness log)\]/, 3, 200), ...pick('g12b', 's19-r4-head4-star20.log', /^\[(star20|star20 next Turn)\]/, 2, 200)]) +
    '<h2>Candidate: refuse extglob groups and more than 3 <code>*</code> per path segment (same gate, both sides)</h2>' +
    pre([...pick('g13', 's19-r4-cand4-cand4.log', /^\[(legit|legitDash|legitClass|extglob3|extglob2|star20)\]/, 6, 200), tag('worker gate alone (6b86c46c Harness):', 'y'), ...pick('g13', 's19-r4-head4-workeronly.log', /^\[(extglob3|star20)\]/, 2, 200)]) +
    '<div class="note bad">Local glob timings against a 250-character name: 3 stars ≈ 20 ms, 4 stars ≈ 0.4 s, 5 stars ≈ 16 s; <code>+(?|?)Z</code> against a 25-character name &gt; 20 s. The count gate is a stopgap — the cost depends on the file name too, so a wall-clock bound on the glob run is the structural fix.</div>',
);

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(figs);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 56, height: 800 } });
const pg = await ctx.newPage();
for (const id of ids) {
  if (!figs[id]) continue;
  fs.writeFileSync(`${OUT}/${id}.html`, figs[id]);
  await pg.goto(`file://${OUT}/${id}.html`);
  await pg.locator('#card').screenshot({ path: `${OUT}/${id}.png` });
  console.log(`${OUT}/${id}.png`);
}
await browser.close();
