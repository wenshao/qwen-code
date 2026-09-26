// PR #12250 round 4: build the three evidence figures from the raw outputs.
//   fig1: whole-suite mutation matrix (out/matrix/summary.txt)
//   fig2: real-stack activeWorkState timelines (rig/out/runs/*.json)
//   fig3: Web Shell at the same instant, head vs M17+child-no-hold (rig/out/ui)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/Users/wenshao/git/qwen-12250-r4/package.json');
const { chromium } = require('playwright');
const D = path.dirname(new URL(import.meta.url).pathname);
const OUT = `${D}/images`;
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #fff; font: 14px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2328; }
.card { padding: 22px 26px 18px; width: max-content; }
h1 { font-size: 18px; margin: 0 0 4px; }
.sub { color: #59636e; margin: 0 0 14px; font-size: 13px; }
table { border-collapse: collapse; }
th, td { border: 1px solid #d1d9e0; padding: 6px 10px; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; text-align: left; font-size: 13px; }
td.m { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; white-space: nowrap; }
td.d { color: #59636e; font-size: 12.5px; max-width: 250px; }
.k { background: #dafbe1; color: #116329; } .s { background: #ffebe9; color: #a40e26; } .n { color: #8c959f; text-align: center; }
.decl { background: #fff8c5; color: #7d4e00; }
.cell b { display: block; font-size: 12.5px; } .cell span { font-size: 11.5px; }
.foot { color: #59636e; font-size: 12px; margin-top: 10px; max-width: 1100px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f6f8fa; padding: 0 3px; border-radius: 3px; }
`;

// ---------- fig1: mutation matrix ----------
const lines = fs.readFileSync(`${D}/out/matrix/summary.txt`, 'utf8').split('\n');
const runs = new Map(); // key arm|mid -> {rc, failed, tests, fails[]} (last run wins: reruns replace load-hit runs)
let cur;
for (const l of lines) {
  const m = l.match(/^(\S+) (\S+) rc=(\d+) tests=(\d+) passed=(\d+) failed=(\d+)/);
  if (m) { cur = { arm: m[1], mid: m[2], tests: +m[4], failed: +m[6], fails: [] }; runs.set(`${m[1]}|${m[2]}`, cur); continue; }
  if (l.startsWith('   x ') && cur) cur.fails.push(l.slice(5));
}
const label = (f) => {
  if (/preheat /.test(f)) return 'preheat (load flake)';
  let m;
  if ((m = f.match(/rejects '(\w+)' while an admitted background turn/))) return `busy-guard table: ${m[1]} row`;
  if ((m = f.match(/rejects '(\w+)' synchronously/))) return `queued-cd table: ${m[1]} row`;
  if (/retains a detached session/.test(f)) {
    if (/'idle' to be 'active'/.test(f)) return 'retention test: activeWorkState line';
    if (/expected \+0 to be 1/.test(f)) return 'retention test: close count';
    return 'retention test';
  }
  if (/drains with the background turn id/.test(f)) return 'drain test (R1-14)';
  return 'other';
};
const cell = (arm, mid) => {
  const r = runs.get(`${arm}|${mid}`);
  if (!r) return '<td class="n">—</td>';
  if (r.failed === 0) {
    const declared = ['M4_branch_callback', 'M7_fork_callback', 'M11_sidetask_release'].includes(mid);
    return `<td class="cell ${declared ? 'decl' : 's'}"><b>survives</b><span>${r.tests} / ${r.tests} pass${declared ? ' (declared)' : ''}</span></td>`;
  }
  const labs = [...new Set(r.fails.map(label).filter((x) => x !== 'preheat (load flake)'))];
  const body = r.failed > 3 ? `${r.failed} tests, incl. ${labs.filter((x) => x !== 'other').join(', ') || 'existing tests'}` : labs.join('<br>');
  return `<td class="cell k"><b>caught</b><span>${body}</span></td>`;
};
const ROWS = [
  ['M2_rewind_admission', 'rewind: admission <code>backgroundTurn</code> term off'],
  ['M16_rewind_relocated', 'rewind: term moved from admission into the queue callback'],
  ['M3_branch_admission', 'branch: admission term off'],
  ['M6_fork_admission', 'fork: admission term off'],
  ['M9_cd_guard', 'cd: guard term off'],
  ['M17_projection_drops_turn', '<code>entryActiveWorkState</code> stops counting the turn'],
  ['M10_entryHasLocalWork', 'retention: <code>entryHasLocalWork</code> drops the turn'],
  ['M15_release_skips_child', 'release closes without asking the child'],
  ['M1b_drain_site_only', 'drain: middle ownership term off (call site)'],
  ['M4_branch_callback', 'branch: queue-callback term off'],
  ['M7_fork_callback', 'fork: queue-callback term off'],
  ['M11_sidetask_release', 'side-task release term'],
];
const ARMS = [['base', 'merge-base tests<br><code>97b1b252</code>'], ['r3', 'round-3 head tests<br><code>fe6ca099</code>'], ['r4', 'this head<br><code>7ab49d5e</code>'], ['merged', 'head + main<br><code>939b4db6</code>']];
const none = (a) => runs.get(`${a}|none`);
const fig1 = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="card" id="c">
<h1>Whole-suite mutation matrix — <code>packages/acp-bridge</code>, one full run per cell</h1>
<p class="sub">Production code is identical within a column; only the test files differ between the first three columns. macOS 26.6 arm64 (M1 Max), Node 22.23.2. Unmutated: ${ARMS.map(([a]) => `${a} ${none(a)?.tests}/${none(a)?.tests}`).join(' · ')}.</p>
<table><tr><th>mutant</th><th>what it breaks</th>${ARMS.map(([, h]) => `<th>${h}</th>`).join('')}</tr>
${ROWS.map(([mid, d]) => `<tr><td class="m">${mid.replace(/_.*/, '')}</td><td class="d">${d}</td>${ARMS.map(([a]) => cell(a, mid)).join('')}</tr>`).join('\n')}
</table>
<p class="foot">“—” = not run in that column this round (round 3 already has them). Yellow = the survivors the PR description declares out of scope. The <code>r4settled</code> control (queued-cd fixture edited so the cd has settled before the operation runs) lets M3, M6 and M16 all survive (2261/2261): the new test name states the precondition that makes the table work. In the head+main column, the first runs of M4/M6/M7/M9/M16/M1b also failed two unrelated <code>preheat</code> fake-timer tests while the host load average was 90–178; the reruns shown here are clean, and <code>none</code> passed in all 3 runs.</p></div>`;

// ---------- fig2: real-stack timelines ----------
const RD = `${D}/rig/out/runs`;
const ARMS2 = [
  ['obs', 'head bundle'],
  ['m17', 'M17: projection drops the turn'],
  ['ur', 'child reports no holds during its turn'],
  ['m17ur', 'M17 + child reports no holds'],
];
const W = 520;
const strip = (r) => {
  const bt = r.samples.filter((s) => s.present && s.backgroundTurn);
  const t0 = bt[0].t, t1 = bt.at(-1).t, span = 23;
  const x = (t) => ((t - t0) / span) * W;
  let segs = '';
  for (let i = 0; i < bt.length; i++) {
    const s = bt[i], e = bt[i + 1]?.t ?? s.t + 0.1;
    const col = s.activeWorkState === 'active' ? '#2da44e' : s.activeWorkState === 'idle' ? '#cf222e' : '#9a6700';
    segs += `<rect x="${x(s.t).toFixed(1)}" y="0" width="${Math.max(0.6, x(e) - x(s.t)).toFixed(1)}" height="16" fill="${col}"/>`;
  }
  const idle = bt.filter((s) => s.activeWorkState === 'idle').length;
  const child = r.projections.childReportsHeldWork.true ?? 0;
  return { svg: `<svg width="${W}" height="16">${segs}</svg>`, n: bt.length, idle, child, hap: bt.filter((s) => s.hasActivePrompt).length, dur: (t1 - t0).toFixed(1), gone: (r.sessionGoneAt - t1).toFixed(2) };
};
let rows2 = '';
for (const [arm, desc] of ARMS2) {
  for (const tag of ['r1', 'r2', 'r3']) {
    const r = JSON.parse(fs.readFileSync(`${RD}/${arm}-aws-${tag}.json`, 'utf8'));
    const s = strip(r);
    rows2 += `<tr>${tag === 'r1' ? `<td rowspan="3" class="d"><b style="color:#1f2328">${arm}</b><br>${desc}</td>` : ''}<td class="m">${tag}</td><td>${s.svg}</td>
<td class="m" style="text-align:right">${s.n - s.idle} / ${s.idle}</td><td class="m" style="text-align:right">${s.child} / ${s.n}</td><td class="m" style="text-align:right">${s.hap} / ${s.n}</td></tr>`;
  }
}
const fig2 = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="card" id="c">
<h1>Real <code>qwen serve</code> + real ACP child: <code>activeWorkState</code> of a detached Session during its background turn</h1>
<p class="sub">One sample every 100 ms of <code>GET /workspaces/:ws/sessions/live-state</code>, from the moment the notification turn is admitted until it ends (~21.5 s, a silent shell call).
<span style="color:#2da44e">■ active</span> <span style="color:#cf222e">■ idle</span>. The bundle's probe line records, per projection, whether the child's fresh report held work.</p>
<table><tr><th>arm</th><th>run</th><th>published <code>activeWorkState</code> over the turn</th><th>active / idle</th><th>child report<br>held work</th><th><code>hasActivePrompt</code><br>true</th></tr>
${rows2}</table>
<p class="foot">Every arm keeps the Session for the whole turn and releases it 0.1–0.2 s after the turn ends (M17 does not touch retention). The real child reports a <code>notification</code> hold for the entire turn, so M17 alone changes nothing on today's stack. Only when the child's report is empty does the daemon-owned term decide, and then M17 publishes <code>idle</code>. In the <code>ur</code> arms the child's cached hold stays until its next 15 s heartbeat, which is why the idle stretch starts at a different point in each run. <code>hasActivePrompt</code> (which includes <code>backgroundTurn</code>) stays true in every sample of every arm.</p></div>`;

// ---------- fig3: Web Shell side by side ----------
const UI = `${D}/rig/out/ui`;
const b64 = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const pane = (arm, title) => {
  const c = JSON.parse(fs.readFileSync(`${UI}/${arm}-capture.json`, 'utf8'));
  const e = c.liveStateEntry;
  const json = JSON.stringify({ hasActivePrompt: e.hasActivePrompt, activeWorkState: e.activeWorkState, backgroundTurn: e.backgroundTurn ? { turnId: '…notification…' } : undefined, clientCount: e.clientCount }, null, 1);
  const hl = json.replace(/("activeWorkState": )("\w+")/, `$1<b style="color:${e.activeWorkState === 'idle' ? '#cf222e' : '#116329'}">$2</b>`);
  return `<div style="width:620px">
<div style="font-weight:600;margin-bottom:6px">${title}</div>
<div style="width:620px;height:176px;border:1px solid #d1d9e0;border-radius:6px;background:url(${b64(`${UI}/${arm}-sidebar-full.png`)}) 0 -388px / 1280px 760px no-repeat"></div>
<div class="foot" style="margin:8px 0 4px">Row DOM: running dot <code>${c.dots.running}</code> · active-work dot <code>${c.dots.activeWork}</code> · tooltip status <code>Running</code></div>
<pre style="margin:0;background:#f6f8fa;border:1px solid #d1d9e0;border-radius:6px;padding:8px 10px;font-size:12px">GET /workspaces/:ws/sessions/live-state  (same instant)
${hl}</pre>
<div class="foot" style="margin-top:4px">[probe-aws] daemon-owned term <code>${c.probeAws.local}</code> · child report held work <code>${c.probeAws.child}</code></div></div>`;
};
const fig3 = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="card" id="c">
<h1>Real Web Shell watching the detached Session mid-turn: identical in both arms</h1>
<p class="sub">Daemon-served Web Shell, headless Chromium. Captured inside the background turn; the M17 arm is captured only after the API had switched to <code>idle</code>.</p>
<div style="display:flex;gap:24px">${pane('obs', 'head bundle')}${pane('m17ur', 'M17 + child reports no holds')}</div>
<p class="foot">The sidebar row, its status dot and the details tooltip all read <code>hasActivePrompt</code> first, and that already covers <code>backgroundTurn</code>. The <code>activeWorkState</code> difference is only visible to clients that read the raw field (HTTP / SDK).</p></div>`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 900 } });
for (const [name, html] of [['fig1-mutation-matrix-r4', fig1], ['fig2-real-stack-active-work-state', fig2], ['fig3-webshell-same-instant', fig3]]) {
  const f = `${OUT}/${name}.html`;
  fs.writeFileSync(f, html);
  const page = await ctx.newPage();
  await page.goto(`file://${f}`);
  await page.locator('#c').screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log('wrote', `${OUT}/${name}.png`);
}
await browser.close();
