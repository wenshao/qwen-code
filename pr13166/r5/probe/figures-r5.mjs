// VERIFICATION RIG ONLY (PR #13166 round 5): evidence figures. Every quoted line is copied from
// out/<db>/*.log (round 4: g12b; round 5: g14).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13166-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig-r5`;
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
const pick = (db, f, re, n = 99, width = 170) => log(db, f).filter((l) => re.test(l)).slice(0, n).map((l) => esc(l.length > width ? l.slice(0, width) + ' …' : l));
const tag = (t, cls) => `<span class="${cls}">${t}</span>`;
// Read a value out of a logged line, so the tables cannot drift from the logs.
const grab = (db, f, re) => {
  for (const l of log(db, f)) {
    const m = l.match(re);
    if (m) return m[1];
  }
  throw new Error(`no match for ${re} in ${db}/${f}`);
};

const figs = {};
figs['r5-01-deadline'] = page(
  'Round-4 blocker on the real stack: 6b86c46c vs 0ce55064',
  'Same rig and probe (S19 / S22): Hosted Harness → Spring Broker → local-process Runtime worker, MySQL Session Store, files/2 Session with ordinary names (package-lock.json, a 32-character .ts file). Round-4 lines come from that run’s logs.',
  '<h2>6b86c46c (round 4): the matcher never returns</h2>' +
    pre([...pick('g12b', 's19-r4-head4-extglob.log', /^\[(extglob3|extglob3 next Turn|extglob3 harness log)\]/, 3), ...pick('g12b', 's19-r4-head4-star20.log', /^\[(star20|star20 next Turn)\]/, 2)]) +
    '<h2>0ce55064 (round 5): bounded, model-correctable error; Session keeps working</h2>' +
    pre([...pick('g14', 's19-r4-head5-r5.log', /^\[(extglob2|extglob3|star20)\]/, 3), ...pick('g14', 's22-cancel-glob-head5.log', /^\[(extglob|normal|stars|cancel at 1\.5 s|after cancel)\]/, 6)]) +
    `<div class="note ok">Runtime workers 3 s after the cancelled run: ${esc(grab('g14', 's22-cancel-glob-head5.log', /^\[runtime workers \(pid %cpu etime\)\] (.*)$/).slice(0, 120))} … — every worker at 0.0 % CPU (round 4 left an orphaned worker spinning at ~82 % for 52 min).</div>`,
);

const bench = log('g14', 'bench-glob-worker.log').filter((l) => l.startsWith('files='));
const benchRow = (l) => {
  const v = (re) => (l.match(re) ?? [])[1];
  return [v(/files=(\d+)/), `${v(/in-thread median=(\d+)ms/)} ms`, `${v(/worker median=(\d+)ms/)} ms`, `${v(/delta=(-?\d+)ms/)} ms`, v(/load=(\d+)/)];
};
figs['r5-02-cost'] = page(
  'What the 5-second deadline costs a legitimate glob',
  'Bench: the same <code>searchGlobDirectory</code> call in-thread (the 6b86c46c path) and in the bundled <code>dist/glob-search-worker.js</code> (the 0ce55064 Hosted path), <code>**/needle.md</code> over synthetic trees, 20 files per directory, median of the logged runs. Real stack: the same pattern in a files/2 Session.',
  '<h2>Per-call overhead of the worker thread (bench)</h2>' +
    table(['files walked', 'in-thread', 'worker thread', 'delta', 'host load'], bench.map(benchRow)) +
    '<h2>Real stack, 0ce55064</h2>' +
    pre([
      tag('Session with 150,000 files: **/needle.md twice, then path: tree', 'y'),
      ...pick('g14', 's21-bigtree-head5-150000.log', /^\[(walk|narrow)\]/, 3),
      tag('Session with 1,000,000 files, same three calls', 'y'),
      ...pick('g14', 's21-bigtree-head5-1000000.log', /^\[(walk|narrow)\]/, 3),
      tag('six globs per model response, three Turns: six ordinary, six distinct +(?|?|?)Z&lt;n&gt;, six ordinary again', 'y'),
      ...pick('g14', 's24-batch-glob-head5-6.log', /^\[(fast|slow) x6\]/, 3),
    ]) +
    '<div class="note">The bound is wall-clock and per call. A full walk of about a million unignored files sits right at it and fails under load (narrowing <code>path</code> recovers). Six bad patterns in one model response run one after another: 6 × 5 s.</div>',
);

figs['r5-03-symlink'] = page(
  'Symlinked search roots (fef2893cf6, 268ea8f876) through the Hosted Harness',
  'files/2 Session at <code>w23</code>: <code>lnk → src</code>, <code>nested/a/b/lnk2 → ../../../src</code>, <code>out → ../outside23</code> (outside the Session, inside the mount), <code>abs → /etc</code>; <code>outside23/leak.ts</code> sits beside the Session.',
  pre(pick('g14', 's23-symlink-roots-head5.log', /^\[(inward|deep|outward|absolute|viaPattern|all|alias cwd)\]/, 7, 200)) +
    '<h2>R7-1 climbing: <code>[.][.]</code> is admitted by the pattern gate (by design), so it reaches the walk</h2>' +
    pre(pick('g14', 's23b-climb-head5.log', /^\[(brackets|half|backslash|extglob|qmark)\]/, 5, 200)) +
    '<h2>…and the walk keeps it inside the Session</h2>' +
    pre(pick('g14', 's23c-root-climb-head5.log', /^\[(up1|upSibling|upSelf|upDeep|viaLinkOut|readBack)\]/, 6, 200)) +
    '<div class="note ok">Climbing under a depth-changing link now names the real file (<code>package.json</code> at the Session root, not <code>nested/a/b/package.json</code>). Nothing above the Session root is listed. A Session whose saved cwd is itself a link is refused by the Broker at the first Turn (409 workspace_unavailable), so the “Session root is a link” branch is unit-level only.</div>',
);

const ledger = fs
  .readFileSync(`${RIG}/out/mut-r5/ledger.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((r) => r.id !== 'baseline');
const verdict = (r) =>
  r.id === 'G4'
    ? A('hangs the suite (killed only by a CI timeout)')
    : /failed/.test(r.summary)
      ? P(`killed — ${esc(r.summary)}`)
      : F(`survived — ${esc(r.summary)}`);
figs['r5-04-gaps'] = page(
  'Mutation sample over the round-5 commits: two survivors guard the deadline itself',
  '15 single-line mutants in a separate worktree at 0ce55064; each runs the suites that own the code (core glob + real-worker tests, or the cli context-worker / executor / approval suites) and is restored byte-for-byte.',
  table(['Mutant', 'Change', 'Result'], ledger.map((r) => [r.id, esc(r.what), verdict(r)])) +
    '<h2>G1 on the real stack: the Turn looks fine, the thread keeps running</h2>' +
    pre([...pick('g15', 's22-cancel-glob-head5-g1.log', /^\[(extglob|stars|cancel at 1\.5 s)\]/, 3, 150), ...log('g15', 'g1-threads.log').filter((l) => l && !l.startsWith('# host')).map(esc)]) +
    '<div class="note info">Candidate tests (+39 core, +26 cli, tests only): wrap <code>Worker.prototype.terminate</code> and require that the thread has terminated before a timed-out or cancelled glob settles, and that a Hosted glob runs on such a thread. They pass at 0ce55064, fail with G1, with <code>void worker.terminate()</code> (not awaited) and with E1; the full context-worker suite stays 794/794.</div>',
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
