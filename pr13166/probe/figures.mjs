// VERIFICATION RIG ONLY (PR #13166): lays scenario logs out as evidence figures.
// Every quoted line is copied from the scenario logs under out/<db>/ (see the assets README).
// usage: node figures.mjs [ids...]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13166-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig`;
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
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}.dim{color:#8b949e}
  .g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}.b{color:#79c0ff}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const P = (t) => ({ c: 'pass', t });
const F = (t) => ({ c: 'fail', t });
const A = (t) => ({ c: 'amber', t });
const N = (t) => ({ c: 'num', t });
const pre = (lines) => `<pre>${lines.join('\n')}</pre>`;
const log = (db, f) => fs.readFileSync(`${RIG}/out/${db}/${f}`, 'utf8').split('\n');
const pick = (db, f, re, n = 99, width = 150) => log(db, f).filter((l) => re.test(l)).slice(0, n).map((l) => esc(l.length > width ? l.slice(0, width) + ' …' : l));

const figs = {};

// 01 real model
const s8 = JSON.parse(fs.readFileSync(`${RIG}/out/g1/s8-real-model-head.json`, 'utf8'));
const row = (x) => {
  const calls = x.trace.filter((t) => t.startsWith('call'));
  const ms = Number(x.turn.match(/(\d+)ms/)[1]);
  return [x.label === 'monorepo files/2' ? 'files/2, Session holds <code>shared → ../../libs/shared</code>' : `<code>hosted-workspace-${x.profile.split('-').pop()}</code>`, N(calls.filter((c) => c.startsWith('call glob')).length), N(calls.filter((c) => c.startsWith('call read_file')).length), N(`${(ms / 1000).toFixed(1)} s`), /8443/.test(x.answer) ? P('8443 · deploy/k8s/overlays/prod/app.config.json') : F('not found — “only read_file … no search”')];
};
const tr = (label, n, re) => s8.find((x) => x.label === label).trace.filter((t) => re.test(t)).slice(0, n).map((t) => esc(t.length > 140 ? t.slice(0, 140) + ' …' : t));
figs['01-real-model'] = page(
  'Real model (qwen3.8-max), same task: files/2 (glob) vs files/1 (no search)',
  'Real MySQL 8.4.7 + Spring server jar (Session Store, embedded Runtime Broker, local Runtime workers) + packaged Hosted Harness at <code>b2a28c4f</code>. Task: “Which port does the PRODUCTION deployment listen on? The setting is in a config file somewhere in this project, path unknown.”',
  table(['Session profile', 'glob', 'read_file', 'Turn', 'Answer'], s8.map(row)) +
    '<h2>files/2 — two searches, then reads</h2>' + pre(tr('files/2', 4, /^(call glob|result glob|call read_file\(\{"file_path":"deploy\/k8s\/overlays\/prod)/)) +
    '<h2>files/1 — 46 guessed paths, all “no file was found”</h2>' + pre(tr('files/1', 7, /^call read_file/)) +
    '<h2>files/2 in a monorepo Session whose directory holds an outward link</h2>' + pre(tr('monorepo files/2', 3, /glob/)) +
    '<div class="note ok">With <code>/2</code> the model found the file in 2 glob calls; with <code>/1</code> it gave up after 46 blind reads. In the monorepo layout, <code>glob **/*</code> was refused twice (finding F3) and the model’s “every file” overview silently lacks <code>shared</code>.</div>',
);

// 02 claims
figs['02-claims'] = page(
  'PR claims on the real stack (head b2a28c4f, main b3dda468)',
  'Each row is a scenario script run against the stack above; counts are the script’s own PASS/FAIL checks.',
  table(
    ['Claim', 'Scenario', 'Result'],
    [
      ['Declarations per profile: files/1 = read/write/edit; files/2 adds glob; shell/2 = shell/1 + glob', 'S1 head', P('12/12')],
      ['main Harness refuses <code>/2</code> at create (400 hosted_tool_profile_unavailable)', 'S1 main', P('3/3')],
      ['Pinning: /2 loaded as /1 or shell/2 → 409 hosted_tool_profile_conflict; reload with no profile keeps /2; /1 stays without glob', 'S1 head', P('incl. above')],
      ['A /1 Session whose model calls glob anyway: refused before any Runtime execution, Session not blocked', 'S1 head', P('0 executions:prepare')],
      ['No-path glob searches only the Session directory; sibling Session (same mount) and Workspace-root files never appear', 'S2', P('20/20')],
      ['<code>path: ".."</code>, <code>src/../..</code>, absolute path, <code>../**/*</code>, <code>/etc/host*</code> refused pre-acquisition', 'S2', P('5 × 0 executions prepared')],
      ['Brace escape <code>{.,..}/**/*</code>, <code>{/etc,src}/*</code>: dispatched, refused by worker output containment', 'S2', P('no sibling name leaked')],
      ['Results, errors (<code>Path does not exist: nope</code>) and the durable record are Session-relative', 'S2 + DB scan', P('0 glob hits for the mount root')],
      ['read_file through an in-Session link to a sibling Session (bot R3-1)', 'S3 main / head', P('main reads SIBLING_SECRET; head refuses')],
      ['>64 KiB glob result (83,478 B from the Broker) → longest whole-line prefix + hint', 'S4', P('8/8 · 64,957 B, 78/100 lines')],
      ['glob pre-approved under default and auto-edit (write_file control waits and expires)', 'S5', P('3/3')],
      ['shell/2 through the Harness route (deferred capture): glob + run_shell_command, reload, 409 as shell/1', 'S6', P('4/4')],
      ['shell/2 with <code>captureBytes</code> (publisher mode)', 'S6b', A('not exercised: rig has no OSS; /1 fails identically')],
      ['Focused unit suites on macOS (5 files)', 'vitest', P('1113/1114 + flake 3/3 alone')],
    ],
  ),
);

// 03 findings
figs['03-findings'] = page(
  'Findings: PR head vs candidate patch (+10/−6, 2 files)',
  'Same stack and scripts; the candidate arm swaps both the Harness bundle and the Runtime worker for the patched build.',
  '<h2>F1 · <code>/managed-runtime/continue</code> rebuilds the tool turn without the profile</h2>' +
    pre([
      '<span class="r">head</span>  ' + pick('g3', 's9-continue-head-v2.log', /continued model requests/, 1)[0],
      '<span class="r">head</span>  ' + pick('g3', 's9-continue-head-v2.log', /harness B log/, 1, 400)[0].replace(/^.*(Hosted Harness turn)/, '$1'),
      '<span class="r">head</span>  ' + pick('g3', 's9-continue-head-v2-shell.log', /continued model requests/, 1)[0],
      '<span class="g">cand</span>  ' + pick('g4', 's9-continue-cand-v2.log', /continued model requests/, 1, 120)[0],
      '<span class="g">cand</span>  ' + pick('g4', 's9-continue-cand-v2-shell.log', /RESULT/, 1)[0] + '   ' + pick('g4', 's9-continue-cand-v2.log', /RESULT/, 1)[0],
    ]) +
    '<h2>F2 · new read_file containment refusal carries the Runtime host path</h2>' +
    pre([
      '<span class="r">head</span>  ' + pick('g1', 's3-symlink-head.log', /readThrough result/, 1, 170)[0],
      '<span class="g">cand</span>  ' + pick('g4', 's3-symlink-cand.log', /readThrough result/, 1, 170)[0],
    ]) +
    '<h2>F3 · one outward link in the Session directory refuses every broad glob</h2>' +
    pre([
      ...pick('g1', 's3-symlink-head.log', /^\[(globAll|globStar) result\]/, 2, 150).map((l) => '<span class="r">head</span>  ' + l),
      ...pick('g4', 's3-symlink-cand.log', /^\[(globAll|globLinkPattern) result\]/, 2, 150).map((l) => '<span class="g">cand</span>  ' + l),
    ]) +
    '<h2>F4 · rollout skew: head Harness offers glob, Runtime worker is the main build (both report managed-runtime-tools/1)</h2>' +
    pre([
      ...pick('g2', 's7-mixed-head.log', /^\[(glob turn|status|holders)\]/, 3, 160),
      ...pick('g2', 's7b-aftermath-head.log', /^\[other Session turn\]/, 1, 160),
      ...pick('g2', 's7b-aftermath-head.log', /^\[reload blocked Session\] \{"drive/, 1, 120),
    ]) +
    '<div class="note bad">F1 and F2 are small fixes in this PR’s own code. F3 is a design choice with a usability cost (seen with the real model). F4 is bot R1-19 made concrete: the first glob against a pre-PR Runtime wedges the Session and holds the Workspace lease.</div>',
);

// 04 mutation
{
  const MUT = `${RIG}/out/mut`;
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const fails = (f) => [...new Set([...strip(fs.readFileSync(`${MUT}/${f}`, 'utf8')).matchAll(/^ (?:FAIL|×) +(.+?)(?: \d+ms)?$/gm)].map((m) => m[1].replace(/^src\/serve\/[^ ]+ > /, '').trim()))];
  const base = new Set(fs.readdirSync(MUT).filter((f) => f.startsWith('baseline-')).flatMap(fails));
  const rows = fs
    .readFileSync(`${MUT}/ledger.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .filter((m) => m.id !== 'baseline' && !m.skipped)
    .map((m) => {
      const killedBy = fails(`${m.id}.log`).filter((x) => !base.has(x));
      return [m.id, esc(m.what), killedBy.length ? P('killed') : F('survived'), killedBy.length ? esc(killedBy[0].slice(0, 70)) + (killedBy.length > 1 ? ` <span class="dim">(+${killedBy.length - 1})</span>` : '') : '<span class="dim">—</span>'];
    });
  const killed = rows.filter((r) => r[2].c === 'pass').length;
  figs['04-mutation'] = page(
    `Mutation sample on the PR's guards: ${killed}/${rows.length} killed`,
    'One anchored edit per mutant in a clean worktree at <code>b2a28c4f</code>; the touched suites run, a mutant counts as killed only by a test that passes on the unmutated baseline (one baseline flake excluded).',
    table(['id', 'mutation', 'result', 'first killing test'], rows) +
      '<div class="note info">H8/H9 = bot round-3 deferred probes, confirmed unpinned. W2/W3 survive because output containment (W4) catches the same escapes — defence in depth with no test of its own. W6: glob’s internal-catch error route is never exercised.</div>',
  );
}

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
