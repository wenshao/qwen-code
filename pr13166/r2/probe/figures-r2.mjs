// VERIFICATION RIG ONLY (PR #13166 round 2): evidence figures from the round-2 scenario logs.
// Every quoted line is copied from out/<db>/*.log (see the assets README).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13166-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig-r2`;
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
figs['r2-01-fixes'] = page(
  'Round 2 at 1130745c: the fixes on the real stack',
  'Same rig as round 1 (MySQL 8.4.7, Spring jar with embedded Broker and local Runtime workers, packaged Hosted Harness). Old = b2a28c4f, new = 1130745c; the Runtime worker is the new build unless noted.',
  table(
    ['Item', 'Old head', 'New head'],
    [
      ['F1 — <code>/managed-runtime/continue</code> keeps the profile (files/2, shell/2)', F('continued request lacks glob → turn_error'), P('glob declared, Turn completes (2/2 each)')],
      ['F2 — read through an in-Session link', F('message carries the host path'), P("<code>Path 'peek/secret.txt' is not within …</code>")],
      ['R2-3 — <code>" ../**/*"</code>, <code>"\\t/etc/host*"</code>', A('dispatched, worker refuses (prepared=1)'), P('refused before acquisition (prepared=0)')],
      ['R4-11 — <code>path: null</code> next to a valid <code>read_file</code>', F('whole batch refused'), P('both calls run')],
      ['R4-9 — stray <code>file_path</code> through a link on a glob call (old worker)', F("glob refused: Path 'peek/secret.txt' …"), P('glob runs, file_path ignored')],
      ['Regression: S1 profiles 12/12 · S2 containment 20/20 · S4 truncation 8/8 · S5 approval 3/3 · S6 shell/2 4/4', '—', P('unchanged')],
    ],
  ) +
    pre([
      tag('old', 'r') + '  ' + pick('g6', 's11-delta-head.log', /^\[wsDotdot\] /, 1, 150)[0],
      tag('new', 'g') + '  ' + pick('g6', 's11-delta-head2.log', /^\[wsDotdot\] /, 1, 150)[0],
      tag('old', 'r') + '  ' + pick('g6', 's11-delta-head.log', /^\[nullPathBatch result\] read_file/, 1, 150)[0],
      tag('new', 'g') + '  ' + pick('g6', 's11-delta-head2.log', /^\[nullPathBatch result\] read_file/, 1, 150)[0],
      tag('new', 'g') + '  ' + pick('g6', 's9-continue-head2-v2.log', /continued model requests/, 1, 150)[0],
    ]),
);

figs['r2-02-brace'] = page(
  'R4-3 on the real stack: one glob pattern wedges the Session and its Workspace',
  'Each Hosted Session has its own Runtime worker here (isolation_class=session), so other Workspaces are unaffected — but the Workspace lease is held and the execution ends unknown.',
  '<h2>New head 1130745c</h2>' +
    pre([
      ...pick('g6', 's13-brace-head2.log', /^\[(A brace12|A brace13|B read_file, same Workspace, during A\]|C read_file)/, 4, 150),
      ...pick('g6', 's13c-nocancel-head2.log', /^\[(A brace14, no cancel|A next Turn|harness log)\]/, 3, 170),
      ...pick('g6', 's13-brace-head2.log', /^\[A brace14 timeline\]/, 1, 400),
      ...pick('g6', 's13b-aftermath-head2.log', /^\[(brace14 execution|reload A\] \{"drive|new Session in ws-a)/, 3, 170),
    ]) +
    '<h2>Candidate: expansion-count bound (1024) before acquisition and in the worker</h2>' +
    pre([...pick('g9', 's15-brace-bound-cand2.log', /^\[(brace10|brace14|range20000|PASS\] Workspace)/, 4, 200), tag('worker bound alone (old Harness):', 'y') + ' ' + pick('g9', 's15-brace-bound-head2.log', /^\[brace14\]/, 1, 170)[0]]) +
    '<div class="note bad">Locally the same glob takes 89 s for 14 <code>{a,b}</code> groups (72 B) and 5.7 s for <code>{1..8000}/*</code> (11 B); cost grows ~quadratically with the expansion count, so a length cap cannot bound it.</div>',
);

figs['r2-03-open'] = page(
  'The other round-4 items left to the maintainer, measured',
  'Monorepo Workspace: Session at <code>packages/cli</code>, <code>node_modules/@acme/ui → ../../../ui</code>, root <code>.gitignore</code> ignores node_modules. main = b3dda468 Harness + worker.',
  table(
    ['Item', 'main', 'new head', 'Reading'],
    [
      ['R4-2 — <code>/1</code> read_file of the linked workspace dependency', P('returns the source'), F('refused'), A('real /1 behaviour change')],
      ['R4-2 — edit / write through that link', A('refused by Hosted file history'), A('same'), 'not a change'],
      ['R3-1 — write_file creating a file through an escaping parent link', P('refused by file history; file absent'), P('same'), 'not reachable through the Harness'],
      ['R4-10 — read_file <code>package.json/main</code> (ENOTDIR), link loop (ELOOP)', F('host path to the model (core ReadFileTool)'), F('host path to the model (executor realpath)'), 'pre-existing class'],
      ['R1-1 — <code>{.,..}/**/*.md</code>, Session 105 files, sibling 300 older', '—', F('success: “Found 405 …”, “[305 files truncated]”'), A('count disclosure, no names')],
      ['R4-4 — <code>glob **/*</code> in that package Session', '—', F('refused (node_modules link listed)'), 'documented'],
      ['R4-1 — W1 recovery of a <code>/2</code> definition', '—', F('unsupported Hosted profile'), A('unit level only')],
    ],
  ) +
    pre([
      tag('main', 'g') + ' ' + pick('g7', 's12-maintainer-main-v1.log', /^\[readDep record\]/, 1, 150)[0],
      tag('new ', 'r') + ' ' + pick('g6', 's12-maintainer-head2-v1.log', /^\[readDep record\]/, 1, 150)[0],
      tag('new ', 'g') + ' ' + pick('g6', 's12-maintainer-head2-v1.log', /^\[writeNewThroughDep record\]/, 1, 150)[0],
      ...pick('g6', 's14-count-head2.log', /^\[braced (header|trailer|listed)\]/, 3, 150),
      tag('main', 'y') + ' ' + pick('g7', 's12-maintainer-main-v1.log', /^\[readThroughFile model saw\]/, 1, 160)[0],
      tag('new ', 'y') + ' ' + pick('g6', 's12-maintainer-head2-v1.log', /^\[readThroughFile model saw\]/, 1, 160)[0],
    ]),
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
