// VERIFICATION RIG ONLY (PR #13107): lays the raw page screenshots out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13107-rig';
const require = createRequire(`${RIG}/wt5/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out-r5`;
fs.mkdirSync(OUT, { recursive: true });

// Screenshots are 1180x860 CSS px at 2x. The conversation panel starts at x=262.
const X0 = 262;
const W = 918;
const strip = (name, y0, y1) =>
  `<div class="strip" style="height:${y1 - y0}px;background-image:url('file://${name.startsWith('/') ? name : RAW + '/' + name}.png');background-position:-${X0}px -${y0}px"></div>`;
const shotBlock = (label, tone, strips, note = '') =>
  `<div class="shot"><div class="label ${tone}">${label}</div>${strips.join('<div class="cut">⋯</div>')}${note ? `<div class="note">${note}</div>` : ''}</div>`;

const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W + 56}px;padding:24px 28px 26px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 16px;line-height:1.45}
  .shot{margin:0 0 18px}
  .label{font-size:13px;font-weight:600;padding:6px 10px;border-radius:6px 6px 0 0;display:inline-block}
  .label.base{background:#3d1f22;color:#ffb3ad}.label.head{background:#173a25;color:#8fe3a8}.label.warn{background:#3d3112;color:#f2cc60}.label.info{background:#1b2a41;color:#9ecbff}
  .strip{width:${W}px;background-size:1180px 860px;background-repeat:no-repeat;background-color:#fff;border:1px solid #30363d}
  .cut{width:${W}px;text-align:center;color:#6e7681;font-size:12px;line-height:14px;background:#161b22;border-left:1px solid #30363d;border-right:1px solid #30363d}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22;width:${W - 22}px}
  .note.ok{border-left-color:#3fb950}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.45;background:#161b22;border:1px solid #30363d;padding:8px 10px;margin:6px 0 0;width:${W - 22}px;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;

const figures = {};

const stripAt = (name, x0, y0, y1) =>
  `<div class="strip" style="height:${y1 - y0}px;background-image:url('file://${name.startsWith('/') ? name : RAW + '/' + name}.png');background-position:-${x0}px -${y0}px"></div>`;




const L = (name) => fs.readFileSync(`${RIG}/out/r5db/${name}.log`, 'utf8');
const P = (txt) => { const m = txt.trim().split('\n').at(-1).match(/(\d+) passed, (\d+) failed/); return [Number(m[1]), Number(m[2])]; };
const beh = ['s1-answer-allow', 's1-answer-deny-zh', 's2-load-base-expiry', 's3-multi', 's4-faults', 's5-sequence-files', 's5-sequence-batch', 's6-skew', 's7-real-model-allow', 's7-real-model-deny', 's8-load-retry', 's10-accepted-then-failed', 's12-r1-1-fix', 's13-itemid-matching', 's14-r5-fixes-a_head-b_head-d_head-e_head-f_head-g_head', 's14-r5-fixes-c_head', 's15-late-reply-switch_fails_head-switch_fails_prev-switch_late_head-switch_late_prev-replace_fails_head-replace_fails_prev-replace_late_head-replace_late_prev', 's9-tool-item-probe'];
let bp = 0, bf = 0; for (const n of beh) { const [p, f] = P(L(n)); bp += p; bf += f; }
const s11 = L('s11-review-findings');
const at = (label) => (s11.split('\n').find((l) => /^(PASS|FAIL)/.test(l) && l.includes(label)) ?? '').slice(0, 4);
const rr = (label) => (at(label) === 'PASS' ? '<span class="amber">reproduces</span>' : '<span class="pass">fixed</span>');
const st = fs.readFileSync(`${RIG}/out/static-r5b/summary.log`, 'utf8').trim().split('\n').filter((l) => /exit=/.test(l));
const vit = (f) => fs.readFileSync(`${RIG}/out/static-r5b/${f}`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(\d+) passed \((\d+)\)/);
figures['r5-01-matrix'] = page(
  'PR #13107 round 5 — 72608f2c03',
  'Head = main <code>e083d6a6b8</code> (#13110, #13131; clean merge, main changed nothing in web-shell) plus the PR\'s 19 files. Java, Hosted Harness and Web Shell rebuilt; MySQL 8.4.7; headless Chromium. "Before" = the round-4 head 24b26f107d, served side by side.',
  `<table><tr><th>check</th><th>result</th></tr>
   ${st.map((l) => { const [k, v] = l.split(' exit='); return `<tr><td>${k}</td><td class="${v === '0' ? 'pass' : 'fail'}">exit ${v}</td></tr>`; }).join('')}
   <tr><td>unit tests, <code>client/components/managed</code> / whole <code>packages/web-shell</code></td><td class="pass">${vit('vitest-managed.log')[1]} / ${vit('vitest-managed.log')[2]} · ${vit('vitest-all.log')[1]} / ${vit('vitest-all.log')[2]}</td></tr>
   <tr><td>real-stack scenarios at the head (incl. real model, expiry, faults, late replies)</td><td><span class="pass">${bp} / ${bp + bf}</span> — the 3 misses are the known R2-1 probe</td></tr>
   <tr><td>R4-1 (itemId rows) · G9 (page half of R1-1)</td><td><span class="pass">fixed</span> (19c606bd5f) · <span class="pass">pinned</span> (7e4b802227)</td></tr>
   <tr><td>R1-2 · R1-3 · R1-4 · R1-5 · R1-8</td><td>${['[R1-2] the stale', '[R1-3] the', '[R1-4]', '[R1-5]', '[R1-8]'].map(rr).join(' · ')}</td></tr>
   <tr><td>R1-7 (Harness call title) · R1-9 (TS2741 in test fixtures)</td><td><span class="pass">fixed</span> · <span class="pass">fixed</span></td></tr>
   <tr><td>late replies after a Session switch or a replaced Action</td><td><span class="pass">isolated</span> (before: a warning beside the wrong card)</td></tr>
   <tr><td><b>R1-6</b> — Refresh after the retry ladder is spent</td><td>${rr('[R1-6]')}: the fix covers <code>enabled: false</code>; Refresh goes through <code>undefined</code>. Candidate +36/−1</td></tr>
   <tr><td>77 source mutants</td><td><span class="amber">64 / 77 killed</span>; N1 (<code>action_already_resolved</code>), A3, A8 are test gaps a +55-line test candidate closes</td></tr></table>`,
);
const Y0 = 560, Y1 = 852;
figures['r5-02-r1-6'] = page(
  'R1-6 still strands the approval after Refresh',
  'Same real pending Action. actions/query fails 4 times (503) until the retry ladder is spent, the user clicks Refresh, and the next read fails once more; the service is healthy from then on. Screens 15 s later.',
  shotBlock('72608f2c03 (head): no retry is scheduled, so no card for 15 s while the service is healthy (5 reads)', 'warn', [strip('s11-r1-6-head', Y0, Y1)]) +
    shotBlock('candidate (+36/−1): a reload also resets the budget, so the 2 s retry brings the card back (6 reads)', 'head', [strip('s11-r1-6-fix', Y0, Y1)], 'The fix in 95fbc3ca96 resets the budget when the reader is withdrawn (<code>enabled: false</code>). Since the R1-1 fix, Refresh makes the capability <code>undefined</code> instead, which keeps the reader, so that reset never runs on this path. The "Retry loading approvals" button still works throughout.'),
);
figures['r5-03-fixed'] = page(
  'Fixed since round 4, before and after',
  'Each pair is the same real flow on the round-4 head (24b26f107d) and on the head (72608f2c03), against the same server.',
  shotBlock('R1-2 · before: a stale tab\'s Reject gets a real 409 action_already_resolved; the card stays and says "Retry the same option"', 'base', [strip('s14-a-prev', 48, 80), strip('s14-a-prev', Y0, Y1)]) +
    shotBlock('R1-2 · head: the card leaves at once, the list is read again, no warning', 'head', [strip('s14-a-head', 48, 80), strip('s14-a-head', 700, 852)]) +
    shotBlock('expiry · before: a lagging tab answers just after expiresAt (409 action_expired); the warning stays on an empty panel', 'base', [strip('s14-c-prev', 48, 80), strip('s14-c-prev', Y0, Y1)]) +
    shotBlock('expiry · head: the card leaves, nothing is left behind', 'head', [strip('s14-c-head', 48, 80), strip('s14-c-head', 700, 852)]) +
    shotBlock('late reply · before: approval 1\'s answer fails after approval 2 replaced it; the warning sits beside approval 2', 'base', [strip('s15-replace-fails-prev', 48, 80), strip('s15-replace-fails-prev', Y0, Y1)]) +
    shotBlock('late reply · head: approval 2 is left alone', 'head', [strip('s15-replace-fails-head', 48, 80), strip('s15-replace-fails-head', Y0, Y1)]),
);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: W + 120, height: 900 }, deviceScaleFactor: 2 });
for (const [name, html] of Object.entries({ ...figures, ...(globalThis.EXTRA ?? {}) })) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, html);
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForLoadState('networkidle');
  await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  const clipped = await p.evaluate(() => [...document.querySelectorAll('td,th,.note,.label')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  console.log(`${name}.png written (clipped elements: ${clipped})`);
  await p.close();
}
await browser.close();
