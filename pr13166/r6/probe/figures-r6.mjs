// VERIFICATION RIG ONLY (PR #13166 round 6): evidence figures. Every quoted line is copied from
// out/<db>/*.log (0ce55064: g16; 0d6a6307: g17; R10b mutant bundle: g18; isolation refusal: g17w).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13166-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig-r6`;
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
figs['r6-01-reach'] = page(
  'Round 6 (0d6a6307): which of the four containment fixes the real stack can reach',
  'Hosted Harness → Spring Broker → local-process Runtime worker, files/2 Sessions. A/B: the same probe on 0ce55064 (round 5, DB g16) and 0d6a6307 (DB g17). Host paths are shown as &lt;HOST&gt;.',
  '<h2>The sibling-ownership arms (R9-1, R11-1, R11-3) need two Sessions in one Runtime worker</h2>' +
    pre(log('g17w', 'isolation-refusal.log').filter(Boolean).map(esc)) +
    '<h2>R10-1: write/edit never reach build() through the Harness; read_file builds do not fail here</h2>' +
    pre([tag('0ce55064', 'y'), ...pick('g16', 's25-build-errors-head5.log', /^\[(wDir|wLinkDir|rootWDir|gBackslash|gSpace)\]/, 5, 190), tag('0d6a6307', 'y'), ...pick('g17', 's25-build-errors-head6.log', /^\[(wDir|wLinkDir|rootWDir|gBackslash|gSpace)\]/, 5, 190)]) +
    pre([tag('S26: targets beyond the Session through peek → ../web — 0ce55064', 'y'), ...pick('g16', 's26-outside-build-head5.log', /^\[(gMissing|gFile|gDir)\]/, 3, 190), tag('0d6a6307', 'y'), ...pick('g17', 's26-outside-build-head6.log', /^\[(gMissing|gFile|gDir)\]/, 3, 190)]) +
    '<div class="note info">Same answers on both heads. R11-2 needs a backslash in glob <code>path</code>, which the Harness refuses before acquisition (prepared=0). These fixes are defence in depth for a co-installed worker or a direct worker caller; the unit tests are their only witness.</div>',
);
figs['r6-02-hostpath'] = page(
  'Pre-existing, not introduced here: read_file errors carry the Runtime host path into durable records',
  'The model is shown the generic error; runtimeError.message keeps the core text with the absolute host path. It is stored in qwen_tool_execution.result_json and in the managed-tool-outcome and managed-message Session resources, and the transcript API returns it. Same on files/1 and files/2, on 0ce55064 and 0d6a6307.',
  pre([...pick('g17', 's25c-read-missing-head6.log', /^\[hosted-workspace-files/, 2, 260), ...pick('g17', 's25b-read-dir-head6.log', /^\[hosted-workspace-files/, 2, 260), ...pick('g17', 's26-outside-build-head6.log', /^\[(rMissing|rDir)\]/, 2, 260)]) +
    pre(pick('g17', 's25-build-errors-head6.log', /^\[(model saw host path|db rows containing realpath)/, 2, 260)) +
    '<div class="note">R10-1 holds its sanitized refusal back only for out-of-boundary targets. The same class (the durable record learns the mount root) remains for in-Session targets: a missing file or a directory. A follow-up could relativize <code>runtimeError.message</code> for file tools the way glob errors already are. (The <code>canonical_cwd</code> rows are the Broker’s own binding metadata and expected.)</div>',
);
const ledger = fs.readFileSync(`${RIG}/out/mut-r6/ledger.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.id !== 'baseline');
const verdict = (r) => (/failed/.test(r.summary) ? P(`killed — ${esc(r.summary)}`) : F(`survived — ${esc(r.summary)}`));
const regress = (f, re) => pick('g17', f, re, 20, 150);
figs['r6-03-regression'] = page(
  'Main merge (0.25.0, V45) did not move the round-5 fixes; mutation sample over the round-6 commits',
  'Regression on 0d6a6307 (DB g17). S5 was re-run with a 20 s approval window because its 3 s check is shorter than a Turn at host load 73–80; S6 still expects the pre-merge tool list, before main added monitor.',
  table(['Check on 0d6a6307', 'Result'], [
    ['S1 profiles (shell/2 = shell/1 + glob, monitor now in both)', P(esc(grab('g17', 's1-profiles-head6.log', /^\[RESULT\] (.*)$/)))],
    ['S2 containment / relativization', A('18/20 — the two brace cases are refused earlier, as in rounds 3–5')],
    ['S4 truncation', P(esc(grab('g17', 's4-truncate-head6.log', /^\[RESULT\] (.*)$/)))],
    ['S5 glob pre-approval (20 s window)', P(esc(grab('g17', 's5-approval-head6.log', /^\[RESULT\] (.*)$/)))],
    ['S6 shell/2 deferred capture', A('deferred-capture checks pass; advertised list now includes main’s monitor; publisher mode still needs OSS')],
    ['S9 continue (files/2, shell/2)', P(esc(grab('g17', 's9-continue-head6-v2.log', /^\[RESULT\] (.*)$/)) + ' · ' + esc(grab('g17', 's9-continue-head6-v2-shell.log', /^\[RESULT\] (.*)$/)))],
  ]) +
    pre([...pick('g17', 's22-cancel-glob-head6.log', /^\[(extglob|stars|cancel at 1\.5 s)\]/, 3, 170), ...pick('g17', 's19-r4-head6-r6.log', /^\[(range65|extglob3|star20)\]/, 3, 170)]) +
    table(['Mutant', 'Change', 'Result'], ledger.map((r) => [r.id, esc(r.what), verdict(r)])) +
    '<h2>R10b on the real stack (bundle copy, DB g18)</h2>' +
    pre(pick('g18', 's26-outside-build-head6-r10b.log', /^\[(gMissing|gFile|gDir)\]/, 3, 190)) +
    '<div class="note info">Without the glob arm’s hold, the caller gets glob’s own validation text in its own spelling: no host path, no sibling name, but it confirms that <code>peek/secret.txt</code> exists as a file beyond the boundary. Low impact here, since the same Session can read that file through the link (worker-local sibling check, round 3).</div>',
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
