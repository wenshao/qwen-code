// Evidence cards for the PR 13598 round-8 report (English only; the Chinese
// text lives in the comment's collapsed block). Renders each card with the
// head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r8';
mkdirSync(OUT, { recursive: true });

// Reference palette, dark mode (validated in round 7 on #1a1a19).
const C = {
  surface: '#1a1a19', panel: '#222220', text: '#ffffff', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a',
  head: '#3987e5', cand: '#d95926', good: '#0ca30c', warn: '#fab219', crit: '#d03b3b',
};
const page = (body, width) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:${C.surface};font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:${C.text}}
  #card{width:${width}px;padding:28px 32px 26px;box-sizing:border-box;background:${C.surface}}
  h1{font-size:23px;margin:0 0 4px;font-weight:650}
  .sub{color:${C.text2};font-size:14px;margin:0 0 18px;line-height:1.45}
  h2{font-size:16px;margin:18px 0 8px;font-weight:650}
  pre{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.5;background:${C.panel};color:${C.text2};
      padding:10px 12px;border-radius:6px;margin:0;white-space:pre;overflow:hidden}
  .note{border-left:3px solid ${C.muted};padding:6px 12px;margin:14px 0 0;color:${C.text2};font-size:14px;line-height:1.5}
  .crit{color:${C.crit}} .good{color:${C.good}} .warn{color:${C.warn}} .hd{color:${C.head}} .cd{color:${C.cand}} .mu{color:${C.muted}}
  table{border-collapse:collapse;width:100%;font-size:13.5px}
  td,th{padding:6px 8px;border-bottom:1px solid ${C.grid};text-align:left;vertical-align:top;color:${C.text2}}
  th{color:${C.muted};font-weight:600;font-size:12.5px}
  td b{color:${C.text};font-weight:600}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .lbl{font-size:12.5px;color:${C.muted};margin:0 0 4px}
  svg text{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}
</style></head><body><div id="card">${body}</div></body></html>`;

const cards = {};
const pass = '<span class="good">&#10003; PASS</span>';
const note = '<span class="warn">&#9888; NOTE</span>';
const doc = '<span class="warn">&#9888; DOCS</span>';

// ---------- 01 summary ----------
cards['01-summary'] = page(`
<h1>PR #13598 round 8: the merged head <span class="cd">4657567277</span> on the real stack</h1>
<p class="sub">The only commit since round 7's <code>07add57a64</code> is a main merge bringing <code>085a44f336</code> (verify-pr SKILL.md). <code>packages/</code> is byte-identical to 07add57a64. But round 7's real-stack builds predate <code>e0ec7224e4</code>, the merge that folded in the actor-role enforcement (#13545), so this round rebuilt jar + dist at the head and re-ran everything. The PR merged as <code>c3968ace2f</code> at 00:26 UTC, while the runs were in flight; the merged tree is the head verified here.</p>
<table>
<tr><th style="width:28%">Check</th><th style="width:12%">Result</th><th>Evidence (r8 = 4657567277)</th></tr>
<tr><td><b>P1-1</b> wake Shell, Tool v3 <code>deferred_v3</code></td><td>${pass}</td><td>3/3 wake runs success, user Turn success; fake OSS 4 PUT + 36 GET; lease released</td></tr>
<tr><td><b>P1-1</b> wake Shell, plain <code>deferred</code></td><td>${pass}</td><td>3/3 wake runs success, user Turn success</td></tr>
<tr><td><b>P1-2</b> RELEASING, cold Broker</td><td>${pass}</td><td>409 not_acquirable &#8594; release 200 in 0.13 s; 5 later runs and the probe Turn complete</td></tr>
<tr><td><b>P1-2</b> RELEASING, live Broker (c6402589ad)</td><td>${pass}</td><td>409 not_ready while the worker is frozen; release 200 within 1 s of the worker resuming</td></tr>
<tr><td><b>qwen3.8-max</b> crash regression</td><td>${pass}</td><td>A1: crashed run failed 50 s after restart, 6 later runs completed. U1: early user Turn completed (one 60 s backoff, as in rounds 6-7). 17 model calls, all 200</td></tr>
<tr><td><b>Actor roles &#215; automations</b> (new)</td><td>${pass}</td><td>Contract matrix holds for 4 actor kinds &#215; 8 routes; a demoted or revoked creator's slots run no Turn</td></tr>
<tr><td>Refused fire under demotion</td><td>${note}</td><td>Deferred, not skipped: 4 slots skipped <code>overlap</code>, the held slot ran 4.5 min late after the restore. After a revoke no actor can retire the definition</td></tr>
<tr><td>Merge residue</td><td>${doc}</td><td>Three <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD</code> lines from e0ec7224e4 in the actor-roles design pair, now on main</td></tr>
<tr><td>CI @ 4657567277</td><td>${pass}</td><td>26 pass, 26 skipped, 0 failed (round 7's triage-test red came from main and is fixed by 085a44f336); review-pr cancelled by the merge</td></tr>
</table>
`, 1240);

// ---------- 02 P1 regression ----------
cards['02-p1-regression'] = page(`
<h1>Both runtime P1s, re-run on the merged head</h1>
<p class="sub">Linux durable container, the r8 jar + dist. P1-1: Tool publication on (fake Aliyun OSS over TLS), shell-profile Sessions, three manual runs whose wake turn calls run_shell_command. P1-2: R1 runs read_file every minute, the Harness SIGKILLed mid read_file, this stack's runtime workers SIGSTOPped so the aftermath's release times out.</p>
<h2>P1-1: wake Shell executions (qwen_tool_execution)</h2>
<div class="two"><div><p class="lbl">v8: <code>deferred_v3</code> (captureBytes injected)</p><pre>turn                execution         mode
0de9cb9b (user)     SETTLED success   deferred_v3
arun_24adf75&#8230;       SETTLED <span class="good">success</span>   deferred_v3
arun_3c472c1&#8230;       SETTLED <span class="good">success</span>   deferred_v3
arun_985dcfd&#8230;       SETTLED <span class="good">success</span>   deferred_v3
reference.promptId = arun_&#8230;:input (logical)</pre></div>
<div><p class="lbl">q8: plain <code>deferred</code></p><pre>turn                execution         mode
d29d05cb (user)     SETTLED success   deferred
arun_24adf75&#8230;       SETTLED <span class="good">success</span>   deferred
arun_3c472c1&#8230;       SETTLED <span class="good">success</span>   deferred
arun_985dcfd&#8230;       SETTLED <span class="good">success</span>   deferred
lease free; every Runtime Session RELEASED</pre></div></div>
<h2>P1-2: Harness&#8594;Broker calls for the crashed wake session</h2>
<div class="two"><div><p class="lbl">c8: cold Broker (Spring + Harness restarted, 01:03:25)</p><pre>01:03:11.7 release wake-d37912e6   err (worker frozen)
01:03:13   SIGCONT; Spring JVM + Harness restarted
01:04:14.8 acquire  409 runtime_session_not_acquirable
01:04:14.9 release  wake-d37912e6  <span class="good">200</span>
01:04:16.9 acquire 200 &#8230; next wake runs complete
01:07:11   R2 read_file Turn: completed in 2 s</pre></div>
<div><p class="lbl">e8: live Broker (only the Harness restarted)</p><pre>01:03:40.3 release wake-d37912e6   err (30 s timeout)
01:03:40.5 acquire  409 runtime_session_not_ready
           &#8230; same pair at 01:04:10, 01:04:40
01:04:42   SIGCONT workers
01:04:42.5 release  wake-d37912e6  <span class="good">200</span>
01:05:57   R2 read_file Turn: completed in 3 s</pre></div></div>
<div class="note">Same results as round 7's r7 / r7f arms. Without c6402589ad (round 7's e6/e7), the live-Broker case refused the Workspace until a manual release.</div>
`, 1240);

// ---------- 03 actor-role matrix ----------
const M = (c) => {
  const [s, code] = c.split(' ');
  const cls = s.startsWith('2') ? 'good' : s === '404' ? 'mu' : 'warn';
  return `<td><span class="${cls}"><b class="${cls}">${s}</b></span>${code ? ' <span class="mu">' + code + '</span>' : ''}</td>`;
};
const row = (who, cells) => `<tr><td><b>${who}</b></td>${cells.map(M).join('')}</tr>`;
cards['03-actor-roles-matrix'] = page(`
<h1>Actor roles (#13545) &#215; automations: the route matrix</h1>
<p class="sub">a8 stack, files profile. <code>rig-actor</code> (OPERATOR) created the Session and the every-minute definition. Each other actor then called every route against them. The access rows are the only difference between the rows below.</p>
<table>
<tr><th style="width:19%">actor (Workspace role)</th><th>GET def</th><th>GET runs</th><th>list</th><th>create</th><th>update</th><th>run now</th><th>retire</th><th>Turn</th></tr>
${row('rig-op2 (OPERATOR)', ['200', '200', '200 n=1', '403 a', '403 a', '403 a', '403 a', '202'])}
${row('rig-wsowner (OWNER)', ['200', '200', '200 n=1', '403 a', '403 a', '403 a', '403 a', '202'])}
${row('rig-reader (READER)', ['200', '200', '200 n=1', '403 a', '403 a', '403 a', '403 a', '403 a'])}
${row('rig-none (no grant)', ['404 b', '404 b', '200 n=0', '404 c', '404 b', '404 b', '404 b', '404 c'])}
</table>
<p class="lbl" style="margin-top:8px">a = session_operation_forbidden &#160; b = automation_not_found &#160; c = session_not_found</p>
<h2>After demoting the creator to READER (01:10:36)</h2>
<table>
<tr><th style="width:34%">call</th><th>answer</th></tr>
<tr><td>creator's Turn</td>${M('403 session_operation_forbidden')}</tr>
<tr><td>rig-op2's Turn (still OPERATOR)</td>${M('409 workspace_unavailable')}</tr>
<tr><td>creator's run now / GET def</td><td><span class="warn"><b class="warn">403</b></span> / <span class="good"><b class="good">200</b></span></td></tr>
<tr><td>rig-op2's Turn after the restore (01:13:57)</td>${M('202')}</tr>
<tr><td>after revoking the creator's grant (01:18:58): creator GET def / retire</td><td><span class="mu"><b class="mu">404</b> / <b class="mu">404</b> automation_not_found</span></td></tr>
</table>
<div class="note">Matches contract v1.37/v1.38: automation mutations belong to the Session's creator (rule class OWNER), and a Workspace OWNER role does not confer it. Reads follow can_read. Turns admit any OPERATOR while the creator-keyed facts hold. Every admitted Turn completed.</div>
`, 1240);

// ---------- 04 role-change timeline (SVG strip) ----------
const slots = [
  ['01:09', 'fired', ''], ['01:10', 'fired', ''], ['01:11', 'late', 'ran 01:15:33'], ['01:12', 'skip', ''], ['01:13', 'skip', ''],
  ['01:14', 'skip', ''], ['01:15', 'skip', ''], ['01:16', 'fired', ''], ['01:17', 'fired', ''], ['01:18', 'fired', ''],
  ['01:19', 'held', 'attempt 7'], ['01:20', 'skip', ''], ['01:21', 'skip', ''], ['01:22', 'skip', ''],
];
const W = 1176, x0 = 8, cw = 82, top = 70;
const fill = { fired: C.good, late: C.warn, held: C.warn, skip: C.panel };
const lab = { fired: 'fired', late: 'held &#8594; fired', held: 'held (firing)', skip: 'skipped' };
const sub2 = { fired: 'completed', late: '', held: '', skip: 'overlap' };
const xs = (m) => x0 + (m - 9) * cw; // minute 01:09 -> 0
let svg = `<svg width="${W}" height="240" viewBox="0 0 ${W} 240">`;
// role bands: OPERATOR 09:00-10:36, READER 10:36-13:57, OPERATOR 13:57-18:58, revoked 18:58-
const band = (a, b, t, col) => `<rect x="${xs(a)}" y="18" width="${xs(b) - xs(a) - 2}" height="26" rx="4" fill="${col}" opacity="0.9"/><text x="${xs(a) + 8}" y="36" fill="#ffffff" font-size="13" font-weight="600">${t}</text>`;
svg += band(9, 10.6, 'OPERATOR', '#2c4a6e');
svg += band(10.6, 13.95, 'creator demoted to READER', '#6e2c2c');
svg += band(13.95, 18.97, 'OPERATOR restored', '#2c4a6e');
svg += band(18.97, 23, 'grant revoked', '#6e2c2c');
slots.forEach(([t, k, extra], i) => {
  const x = x0 + i * cw;
  svg += `<rect x="${x}" y="${top}" width="${cw - 2}" height="64" rx="4" fill="${fill[k]}" ${k === 'skip' ? `stroke="${C.grid}"` : ''}/>`;
  svg += `<text x="${x + 6}" y="${top + 18}" fill="${k === 'skip' ? C.text2 : '#1a1a19'}" font-size="12.5" font-weight="700">${t}</text>`;
  svg += `<text x="${x + 6}" y="${top + 36}" fill="${k === 'skip' ? C.muted : '#1a1a19'}" font-size="11.5">${lab[k]}</text>`;
  svg += `<text x="${x + 6}" y="${top + 52}" fill="${k === 'skip' ? C.muted : '#1a1a19'}" font-size="11.5">${extra || sub2[k]}</text>`;
});
svg += `<text x="${x0}" y="${top + 92}" fill="${C.text2}" font-size="12.5">Each cell is one due slot of the every-minute definition (overlap: skip). Amber = a claim refused at the Spring connector (409 workspace_unavailable) and deferred with backoff.</text>`;
svg += `<text x="${x0}" y="${top + 112}" fill="${C.text2}" font-size="12.5">Green = fired and the run completed. Grey = skipped overlap, because the deferred claim still counts as active. No automation Turn ran while the creator was below OPERATOR.</text>`;
svg += `<text x="${x0}" y="${top + 140}" fill="${C.muted}" font-size="12">01:11 claim: refused at +0, +5, +10, +20, +40, +75, +140 s; the next re-drive, at 01:15:30 (96 s after the restore), fired it 4.5 min late.</text>`;
svg += `<text x="${x0}" y="${top + 158}" fill="${C.muted}" font-size="12">01:19 claim: still firing at attempt 7 when the stack stopped. The code bounds it at 64 attempts (&#8776; 4 h), then records it unknown.</text>`;
svg += `</svg>`;
cards['04-role-change-timeline'] = page(`
<h1>Demote, restore, revoke: what the scheduled slots did</h1>
<p class="sub">a8 stack, same definition as the matrix card. The creator's access row was changed directly in SQL, as an operator would. The occurrence ledger (qwen_managed_automation_occurrence) and the Session's runs list are the evidence.</p>
${svg}
<h2>What this means</h2>
<table>
<tr><td style="width:30%"><b>Security property</b></td><td><span class="good">holds</span>: the connector re-checks the creator's grant on every relay (design decision 5), so a demoted or revoked creator's definition runs nothing</td></tr>
<tr><td><b>Refusal classification</b></td><td><span class="warn">deferred, not skipped</span>: the refusal is not a DaemonHttpException, so the scanner treats it as an unobtainable answer. The slot stays <code>firing</code>, later slots skip <code>overlap</code>, and the held slot fires late once the grant returns. The same shape as round 6's note on R3-11</td></tr>
<tr><td><b>After a revoke</b></td><td><span class="warn">no one can retire it through the API</span>: the creator gets 404 (no read), every other actor 403 (creator-only mutations, even a Workspace OWNER). Per the code, the claim retries for ~4 h, is recorded unknown, and the next due slot claims again. The design's open question 3 settled mutations on the Session creator and left other roles to the actor-role work, which has now landed</td></tr>
</table>
`, 1240);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1300, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  const file = `${OUT}/${name}.html`;
  writeFileSync(file, html);
  await pg.goto('file://' + file);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'clipped-pre:', clipped);
}
await browser.close();
