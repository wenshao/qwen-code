// Evidence cards for PR #13365, built from the run artifacts in the
// scratchpad and screenshotted with the PR tree's Playwright. English only;
// the Chinese text lives in the PR comment's collapsed block.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/82bd70be-da86-4042-ac1d-b63b9f729043/scratchpad';
const OUT = `${S}/figs/out`;
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const read = (p) => fs.readFileSync(p, 'utf8');
const jsonl = (p) => read(p).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--amber:#d29922}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1360px;padding:28px 32px 24px;background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--mut);margin:0 0 6px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:6px 10px;vertical-align:top;text-align:left}
th{background:var(--panel);color:var(--mut);font-weight:600}td.c,th.c{text-align:center}
code,.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
pre{background:var(--panel);border:1px solid var(--line);padding:10px 12px;margin:0;white-space:pre;overflow:hidden;line-height:1.4}
.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.mut{color:var(--mut)}.blue{color:var(--blue)}
.note{border-left:3px solid var(--amber);padding:8px 12px;margin-top:14px;background:var(--panel);font-size:14px}
.note.ok{border-color:var(--green)}.note.bad{border-color:var(--red)}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.p-red{background:#3d1214;color:#ffa198}.p-green{background:#0f2e1a;color:#7ee787}.p-amber{background:#3a2a07;color:#e3b341}.p-blue{background:#0c2d4f;color:#79c0ff}
.foot{color:var(--mut);font-size:12px;margin-top:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
`;
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${foot ? `<div class="foot">${foot}</div>` : ''}</div></body></html>`;
const cell = (fail, total) => fail === 0 ? `<td class="c ok">0 / ${total}</td>` : `<td class="c bad">${fail} / ${total}</td>`;

// ---------- IT logs ----------
function itRounds(file) {
  return read(file).split('\n').filter((l) => l.includes('ISSUE13333 round')).map((l) => {
    const m = l.match(/staggerMs=(\d+) burst=(\d+) turns=(\d+).*admissionFailures=(\d+)/);
    return { stagger: +m[1], burst: +m[2], fail: +m[4] };
  });
}
const IT_ARMS = [
  ['base', 'merge-base store (8a1a2efe27) + new IT', ['base-r1', 'base-r2']],
  ['mturn', 'PR minus the turn-probe hunk', ['mturn-r1', 'mturn-r2']],
  ['mscope', 'PR minus the scope hunk', ['mscope-r1', 'mscope-r2']],
  ['pr', 'PR head 9df557594f', ['pr-r1', 'pr-r2']],
];


const R2 = JSON.parse(read(`${S}/rig/summary-r2a.json`));
const R1 = JSON.parse(read(`${S}/rig/summary-a.json`));
const c2 = (arm, sc, n, src = R2) => { const r = src.find((x) => x.arm === arm && x.scenario === sc && x.n === n); return r ? cell(r.e500, r.requests) : '<td class="c mut">-</td>'; };
function fig5() {
  const itArms = [['pr2', 'new head 1f2ffe30a5', ['../pr2-full', 'pr2-r1', 'pr2-r2']], ['base', 'new head minus the turn hunk (the PR\'s mutation check)', ['base-r3', 'base-r4']]];
  const itRows = itArms.map(([arm, label, files]) => {
    const rounds = files.flatMap((f) => itRounds(`${S}/it/${f}.log`));
    const tds = [4, 8, 12].map((b) => { const rs = rounds.filter((r) => r.stagger === 0 && r.burst === b); return cell(rs.reduce((s, r) => s + r.fail, 0), rs.length * b); }).join('');
    const st = rounds.filter((r) => r.stagger === 500).reduce((s, r) => s + r.fail, 0);
    return `<tr><td><b>${arm}</b> <span class="mut">${label} · ${files.length} runs</span></td>${tds}<td class="c ${st ? 'bad' : 'ok'}">${st} failures</td></tr>`;
  }).join('');
  const sc = [['diffkey', 'distinct-key Turn submits', [4, 8]], ['samekey-create', 'public create, one key', [3, 4, 8]], ['samekey-create-ws', 'Workspace create, one key', [3, 8]], ['diffkey-ws', 'Workspace create, distinct keys', [8]], ['samekey-submit', 'Turn submit, one key', [8]]];
  const rows = sc.flatMap(([s, label, ns]) => ns.map((n) => `<tr><td>${label}, ${n}-way</td>${c2('base', s, n)}${c2('pr', s, n, R1)}${c2('pr2', s, n)}</tr>`)).join('');
  const w = (run) => JSON.parse(read(`${S}/runs/${run}/rounds.jsonl`).trim().split('\n')[0]);
  const w8 = w('r2b-pr2-n8'), w10 = w('r2b-pr2-n10');
  const deadlocks = 42;
  const html = `
<h2>1 · Diff vs merge-base is now one functional line: <code>findCommand(…, idempotencyKey, true)</code> → <code>findCommand(…, idempotencyKey)</code> (plus comment) and the new IT · store file byte-identical to round 1's mscope candidate</h2>
<h2>2 · New IT on MySQL 8.4.7 — failed submissions, stagger-0 rounds</h2>
<table><tr><th>arm</th><th class="c">burst 4</th><th class="c">burst 8</th><th class="c">burst 12</th><th class="c">500 ms-staggered rounds</th></tr>${itRows}</table>
<h2>3 · Packaged stack (Spring jar + qwen serve --profile hosted-harness + MySQL 8.4.7) — requests returning 500, 6 rounds per cell</h2>
<table><tr><th>scenario</th><th class="c">base</th><th class="c">round 1 head 9df5575</th><th class="c">round 2 head 1f2ffe30a5</th></tr>${rows}</table>
<h2>4 · Other checks on 1f2ffe30a5</h2>
<table>
<tr><td>full verify (unit + IT + checkstyle)</td><td class="ok">556 tests, 0 failures (1 skipped) · IT 6/6 rounds · 0 checkstyle violations</td></tr>
<tr><td>test-merge with main 1fb5a71522</td><td class="ok">clean merge · 567 tests · IT 6/6 · 0 checkstyle violations</td></tr>
<tr><td>CI SDK Java run 37185099341</td><td class="ok">all green; Hosted job runs the new IT 6/6 on MySQL 8.4.6, HostedHarnessMySqlIT 2/2 (round 1's red leg passed on re-run attempt 2)</td></tr>
<tr><td>InnoDB lock_deadlocks across this round's IT runs</td><td>${deadlocks}, equal to base's 42 failed submits, so the new head contributed 0</td></tr>
<tr><td>pre-existing wedge (unchanged, out of scope)</td><td class="warn">8 Turns settle in ${(w8.settleMs / 1000).toFixed(1)} s · 10 Turns wedge: RUNNING 10, ${w10.pinnedVirtualThreads} pinned in HarnessEventStream.next, ${w10.carriersBusy}/10 carriers</td></tr>
</table>
<div class="note ok">Dropping the scope hunk removed the same-key regression (0 failures on both create paths, as on base) and kept the admission fix intact: 0 distinct-key failures on the new head, versus base's 17/24 and 42/48.</div>`;
  return page('#13365 round 2 · scope hunk dropped: same-key regression gone, turn fix intact', 'Head 1f2ffe30a5 · base = merge-base store 8a1a2efe27 · MySQL 8.4.7 native · JDK 21', html, 'Same rig as round 1: the evidence branch has the scripts and raw results. Base cells come from two interleaved passes of 3 reps; one base 4-way round let 2 of 4 submits through instead of 1.');
}
const require = createRequire(`${S}/wt-pr/package.json`);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const pg = await (await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1424, height: 900 } })).newPage();
fs.writeFileSync(`${OUT}/05-round2.html`, fig5());
await pg.goto(`file://${OUT}/05-round2.html`);
console.log('clipped-pre:', await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length));
await pg.locator('#card').screenshot({ path: `${OUT}/05-round2.png` });
await browser.close();
