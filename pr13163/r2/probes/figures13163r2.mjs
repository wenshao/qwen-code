// VERIFICATION RIG ONLY (PR #13163): lays the measured results and the raw page screenshots out as evidence figures.
// Every number comes from the probe ledgers under out/<db>/; image regions are unmodified crops of fig/raw/*.png.
// usage: node figures13163.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13163-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });
const W = 1080;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W + 56}px;padding:22px 28px 24px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  h2{font-size:14.5px;margin:16px 0 8px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:6px;table-layout:fixed}
  td,th{overflow-wrap:anywhere}
  tr > :first-child{width:26%}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.amb{color:#d29922;font-weight:600}.dim{color:#8b949e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1f2630;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22;width:${W - 22}px}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}
  .shots{display:flex;gap:16px}
  .shot{flex:1}
  .label{font-size:13px;font-weight:600;padding:6px 10px;border-radius:6px 6px 0 0;display:inline-block}
  .label.g{background:#173a25;color:#8fe3a8}.label.r{background:#3d1f22;color:#ffb3ad}
  .strip{background-repeat:no-repeat;background-color:#fff;border:1px solid #30363d}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const t = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${/^\s*<span class="(ok|bad|amb|dim)">/.test(c) || /^[0-9+]/.test(c) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const ok = (s) => `<span class="ok">${s}</span>`;
const bad = (s) => `<span class="bad">${s}</span>`;
const amb = (s) => `<span class="amb">${s}</span>`;
const dim = (s) => `<span class="dim">${s}</span>`;

const figs = {};
const OUT2 = `${RIG}/fig/out2`;
fs.mkdirSync(OUT2, { recursive: true });
figs['r2-01-ab'] = page(
  'Round 2 at 3363fff4: creator cancel under refused authorization, against main with #13112 merged',
  'Real stack as in round 1, rebuilt: one packaged Hosted Harness from this head (identical CLI/Harness/Broker on all arms), Spring jars from this head, from its merge base <code>ba097945</code> (main, #13112 merged) and from a trial merge with current main <code>5130c1a7</code> (#13211 durable local-process opted out on macOS). Model call held 30 s, then <code>write_file</code>.',
  t(['Condition at cancel time', 'main <code>ba097945</code> (#13112 merged)', 'this PR <code>3363fff4</code>', 'PR ⊕ main <code>5130c1a7</code>'], [
    ['<b>real model qwen3.8-max</b>: step-01…step-12 one per call; revoke + cancel after step-02, grant back 1 s later', `${bad('409')} → run 1: ${bad('COMPLETED')} at 28.7 s, files ${bad('2 → 12')}, 10 tool calls after the cancel; run 2: tool call raced the revoke → ${amb('RUNNING')} (Harness blocked)`, `${ok('202')} → run 1: ${ok('CANCELLED')} at 1.05 s, ${ok('2 → 2')}; run 2: tool call raced the revoke → ${amb('CANCELLING')} (Harness blocked), ${ok('2 → 2')}`, dim('not run')],
    ['<code>can_create</code> revoked, restored 1 s later', `${bad('409')} → ${bad('COMPLETED')} at 30.7 s, file ${bad('written-after-cancel')}`, `${ok('202')} in 13 ms → aborted at 65 ms → ${ok('CANCELLED')}, no file`, `${ok('202')} → ${ok('CANCELLED')}, no file`],
    ['<code>DRAINING</code>, restored 1 s later', `${bad('409')} → ${bad('COMPLETED')} at 30.9 s, file ${bad('written')}`, `${ok('202')} in 14 ms → ${ok('CANCELLED')}, no file`, `${ok('202')} → ${ok('CANCELLED')}, no file`],
    ['<code>can_create</code> revoked / <code>DRAINING</code> until the end', `${bad('409')} → model runs 30 s → write refused → ${amb('FAILED')}`, `${ok('202')} → ${ok('CANCELLED')} at 419 / 321 ms`, `${ok('202')} → ${ok('CANCELLED')} at 300 / 368 ms`],
    ['re-registered (generation + 1)', `202 → CANCELLED, but <code>workspaceTurns</code> still true`, `${ok('202')} → ${ok('CANCELLED')} at 331 ms, <code>workspaceTurns</code>=false`, `${ok('202')} → ${ok('CANCELLED')}`],
    ['storage changed / control', dim('—'), `${ok('202')} → ${ok('CANCELLED')} 268 / 515 ms`, dim('—')],
    ['bob (reader) / carol (other creator) / mallory / creator without <code>can_read</code>', dim('—'), `${ok('409 / 409 / 404 / 404')}, refusal kept`, dim('—')],
    ['Turn waiting on a pending approval Action, revoke / DRAINING', dim('—'), `${ok('202')} → ${ok('CANCELLED')} 0.27 / 0.24 s; Action <code>cancelled</code>; late answer 409 action_cancelled`, dim('—')],
    ['cancel admitted by the non-owner Spring (2 JVMs), one delivery dropped', dim('—'), `owner delivers at ${ok('19.5 s')} (${ok('39.5 s')} with one drop) → CANCELLED, no file`, dim('—')],
  ]) +
    t(['Admission and replay', 'main <code>ba097945</code>', 'this PR <code>3363fff4</code>', 'PR ⊕ main'], [
      ['re-registration (generation / storage): submit', `${bad('202')} → FAILED workspace_unavailable in 19–24 ms; Turn and command rows written; <code>workspaceTurns</code> true`, `${ok('409')} in 7 ms, no Turn or command row, <code>workspaceTurns</code> false`, ok('409, no rows')],
      ['mallory replays alice\'s submit / rename key', '404 / 404', `${ok('404 / 404')} (round 1: 202 + turn_id / 200 + title)`, ok('404 / 404')],
      ['alice replays her own keys after <code>can_create</code> is revoked', `${amb('409 / 409')} (cannot recover)`, `${ok('202 / 200')}`, ok('202 / 200')],
      ['rename: Harness answers 4xx / 5xx / drop once, then the same key', '503 + FAILED row → 200 replay', `503 + FAILED row → ${ok('200 replay')} (round 1: 409 then ${bad('500')})`, ok('same')],
    ]),
);
figs['r2-02-status'] = page(
  'Round 2: what changed since the round-1 report, suites, mutation, and the inherited wedge',
  'Round-1 report was at <code>9c0bcf41</code>. Since then #13112 landed (<code>2b15eac8</code>) and this branch merged main; its diff against main is now 15 files, +437/−42, and merges cleanly with current main.',
  `<h2>Round-1 open items</h2>` +
    t(['Item', 'Status at <code>3363fff4</code>'], [
      ['CI MariaDB IT: <code>WorkspaceSessionCloseMySqlIT:167</code>', ok('fixed: CI job green; locally 51/51 ITs')],
      ['rename same-key retry after a refusal → 500', ok('fixed: adopts main\'s FAILED-row retirement; 4xx / 5xx / drop all recover with the same key')],
      ['submit replay before the read grant', ok('fixed: <code>requireReadableSession</code> before replay in submit and rename; mallory 404 / 404')],
      ['merge order with #13112 (8 conflicting files)', ok('resolved: #13112 merged first; diff is the delta only')],
      ['N6 (canRead clause) / N10 (storage_id) untested', `${dim('see mutation below')}`],
      ['inherited Harness "recovery blocked" wedge', bad('still present; now also hit by the real model on this head (1 of 2 runs)')],
    ]) +
    `<h2>Suites</h2>` +
    t(['Tree', 'Result'], [
      ['<code>3363fff4</code>, CI-equivalent lane (<code>-Pmysql-integration verify checkstyle:check</code>, MySQL 8.4.7, TZ=UTC)', ok('549 unit + 51 IT, 0 failures, 0 Checkstyle violations')],
      ['PR ⊕ main <code>5130c1a7</code>, same lane', ok('557 unit (1 skipped) + 52 IT, 0 failures, 0 Checkstyle violations')],
      ['WebShell vitest (changed files + generated-type drift)', ok('58/58')],
      ['CI at <code>3363fff4</code>', ok('all jobs green, including MariaDB / Java 21 and Hosted MySQL; review-pr still running when posted')],
    ]) +
    `<h2>Mutation (PR delta only)</h2>` +
    t(['Mutant', 'Result'], []) +
    `<h2>Inherited: a tool call that collides with the revocation (unchanged)</h2>` +
    t(['After the first write, revoke, the second write hits Broker 409', 'this PR <code>3363fff4</code>'], [
      ['Harness', '"recovery blocked" at +6.0 s, 3/3 fake-model runs; real model 1 of 2 runs here and 1 of 2 on main'],
      ['no cancel', `${bad('RUNNING')} after 70 s; next Turn 409 turn_active`],
      ['cancel while revoked / after restore', `202 → ${bad('CANCELLING')}; still CANCELLING at 254 s after 13 re-sent POST /cancel (204 each), ${bad('no bound')}`],
    ]) +
    `<div class="note">The Harness sets <code>session.blocked</code> and never writes the Turn result (<code>hosted-harness-session.ts</code>); no extra file was written in any run. Main has the same wedge now that #13112 admits later Turns, so it is not a regression of this PR; it is the remaining gap in "stop a bound Turn under refused authorization". Closest open issue: #13054.</div>`,
);
const crop = (name, y0, y1) => `<div class="strip" style="width:${W / 2 - 8}px;height:${Math.round((y1 - y0) * ((W / 2 - 8) / 1810))}px;background-image:url('file://${RAW}/${name}.png');background-size:${Math.round(2360 * ((W / 2 - 8) / 1810))}px auto;background-position:-${Math.round(526 * ((W / 2 - 8) / 1810))}px -${Math.round(y0 * ((W / 2 - 8) / 1810))}px"></div>`;
figs['r2-03-webshell'] = page(
  'WebShell at 3363fff4: banner wording fixed; Cancel still hidden under refusal',
  'Real Managed panel (vite from this head) on the same running bound Turn, as the creator. Left: grants intact. Right: <code>can_create</code> revoked, page reloaded. Crops of unmodified 2x screenshots.',
  `<div class="shots"><div class="shot"><div class="label g">grants intact — "Cancel turn" shown</div>${crop('ui-01-running-granted-en', 120, 330)}${crop('ui-01-running-granted-en', 1320, 1700)}</div><div class="shot"><div class="label r">can_create revoked — no Cancel, no composer</div>${crop('ui-02-running-revoked-en', 120, 345)}${crop('ui-02-running-revoked-en', 1320, 1700)}</div></div>` +
    `<div class="note">Measured: Cancel buttons 1 → 0, <code>workspaceTurns</code> true → false; the API cancel then answered 202 and the Turn ended CANCELLED. The banner now reads "You cannot send messages in this Session." (from #13112). Cancel under refusal stays API-only, as the PR's Risk section says.</div>`,
);
const mut = JSON.parse(fs.readFileSync(`${RIG}/out/mut4-rows.json`, 'utf8'));
const browser = await chromium.launch({ headless: true });
for (const [name, html0] of Object.entries(figs)) {
  const html = html0.replace('__MUT_ROWS__', '').replace('<tr><th>Mutant</th><th>Result</th></tr>', '<tr><th>Mutant</th><th>Result</th></tr>' + mut.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td></tr>`).join(''));
  const file = `${OUT2}/${name}.html`;
  fs.writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForTimeout(300);
  await p.locator('#card').screenshot({ path: `${OUT2}/${name}.png` });
  await ctx.close();
  console.log(`${OUT2}/${name}.png`);
}
await browser.close();
