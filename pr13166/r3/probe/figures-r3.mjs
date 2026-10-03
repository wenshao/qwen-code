// VERIFICATION RIG ONLY (PR #13166 round 3): evidence figures from the round-2 scenario logs.
// Every quoted line is copied from out/<db>/*.log (see the assets README).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13166-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig-r3`;
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
figs['r3-01-fixes'] = page(
  'Round 3 at 62a1f9d3: what the real stack shows for each round-4 fix',
  'Same rig (MySQL 8.4.7, Spring jar + embedded Broker + local Runtime workers, packaged Hosted Harness); deps reinstalled from the new lockfile. One Runtime worker per Hosted Session (isolation_class=session).',
  table(
    ['Round-4 item', 'Real stack at 62a1f9d3', 'Reading'],
    [
      ['R1-1 — count over the display slice', P('<code>{.,..}/**/*.md</code> refused before acquisition; <code>{docs,peek/docs}/*.md</code> (sibling only in the collected tail) refused; own 105 still “Found 105”'), P('fixed')],
      ['R3-1 — write through an in-Session link', P('refused (Hosted file history first, worker now too); no file created'), P('fixed (was already unreachable)')],
      ['R4-2 — /1 read of a linked workspace dependency', P('returns the source again (/1 and /2)'), P('fixed')],
      ['R4-2 — “a sibling Session stays refused”', F('read_file peek/secret.txt returns the active sibling Session\'s file (/1 and /2)'), F('does not hold on this topology')],
      ['F3 — outward link listed by a broad glob', P('<code>**/*</code> lists <code>peek</code>, <code>node_modules/@acme/ui</code>; <code>peek/**/*</code> still refused'), P('fixed')],
      ['R4-3 — brace budget 4096', A('<code>{a,b}</code>×12 runs (2.1 s), ×13 refused — but a range and a nested group bypass it'), F('see next figure')],
      ['R4-1 — W1 recovery of /2', P('new <code>it.each</code> green; reverting the list turns both red'), P('fixed (unit level)')],
      ['Regression: S1 12/12 · S2 20/20 (2 brace cases now refused earlier) · S4 8/8 · S5 3/3 · S6 4/4 · S9 2/2 + 2/2', '—', P('unchanged')],
    ],
  ) +
    pre([
      ...pick('g10', 's16-sibling-head3-v2.log', /^\[(Session B|readSibling|readDep|writeSibling|globAll|runtime bindings)/, 6, 170),
    ]),
);
figs['r3-02-budget'] = page(
  'R4-3 at 62a1f9d3: the comma-counting budget misses ranges and nested groups',
  '<code>globPatternWithinBudget</code> multiplies the comma count of each top-level group; <code>{1..20000}</code> counts 1 and an outer group hides the groups inside it. Candidate: one shared exact counter (ranges, nesting) at both gates, budget kept at 4096.',
  '<h2>62a1f9d3</h2>' +
    pre([...pick('g10', 's17-budget-head3-range.log', /^\[(brace12|brace13|range4000|range20000|range20000 next Turn|range20000 harness log)\]/, 6, 180), ...pick('g10', 's17-budget-head3-nested.log', /^\[(nested14|nested14 next Turn)\]/, 2, 180)]) +
    '<h2>Candidate (same rig, fresh DB)</h2>' +
    pre([...pick('g11', 's17-budget-cand3-all.log', /^\[(brace12|brace13|nestedSmall|range4000|range20000|nested14)\]/, 6, 180), tag('worker gate alone (62a1f9d3 Harness):', 'y'), ...pick('g11', 's17-budget-head3-workeronly.log', /^\[(range20000|nested14)\]/, 2, 180)]),
);
figs['r3-03-boundary'] = page(
  'Is the per-Session directory a boundary? Any creator can pin a Session anywhere in the Workspace',
  'Same Workspace: carol (a creator) opens Sessions at the Workspace root and at the sibling directory itself — no link needed.',
  pre(pick('g11', 's18-root-session-head3.log', /^\[carol/, 4, 200)) +
    '<div class="note info">The Workspace mount is the boundary the containment actually enforces (and should keep enforcing). The “another installed Session” refusal only sees Sessions installed in the same worker process, which never happens with isolation_class=session, and per-Session confidentiality is not part of the access model anyway.</div>',
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
