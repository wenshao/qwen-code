// VERIFICATION RIG ONLY (PR #13107): lays the raw page screenshots out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13107-rig';
const require = createRequire(`${RIG}/wt5/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out-r4`;
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



const L = (name) => fs.readFileSync(`${RIG}/out/r4db/${name}.log`, 'utf8');
figures['r4-02-itemid-matching'] = page(
  'After #13037: the approval card no longer finds its tool row',
  'Same real pending Action, same transcript Item (Java itemId plus attributes.input, the shape the R2-1 follow-up would produce), three Web Shell builds against the same server.',
  shotBlock('9522974f9d (before the merge): the row is expanded and the card shows the call arguments', 'head', [strip('s13-with-input-prev', 285, 852)]) +
    shotBlock('24b26f107d (head): rows are keyed by itemId now, so the row stays collapsed and the card says arguments are unavailable', 'warn', [strip('s13-with-input-head', 285, 852)]) +
    shotBlock('candidate patch (+40/−3): rows keep the call ID; the card finds its row again', 'head', [strip('s13-with-input-fix', 285, 852)], 'With today\'s Java shape (no input) all three show the notice, so nothing changes for users until tool Items carry arguments; then the head would still hide them.'),
);
const P = (txt) => { const m = txt.trim().split('\n').at(-1).match(/(\d+) passed, (\d+) failed/); return [Number(m[1]), Number(m[2])]; };
const beh = ['s1-answer-allow', 's1-answer-deny-zh', 's2-load-base-expiry', 's3-multi', 's4-faults', 's5-sequence-files', 's5-sequence-batch', 's6-skew', 's8-load-retry', 's7-real-model-allow', 's7-real-model-deny', 's10-accepted-then-failed', 's12-r1-1-fix', 's13-itemid-matching', 's9-tool-item-probe'];
let bp = 0, bf = 0; for (const n of beh) { const [p, f] = P(L(n)); bp += p; bf += f; }
const s11 = L('s11-review-findings');
const at = (label) => (s11.split('\n').find((l) => l.includes(label)) ?? '').slice(0, 4);
const st = fs.readFileSync(`${RIG}/out/static-r4/summary.log`, 'utf8').trim().split('\n').filter((l) => /exit=/.test(l));
const vit = (f) => fs.readFileSync(`${RIG}/out/static-r4/${f}`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(\d+) passed \((\d+)\)/);
const mut = fs.readFileSync(`${RIG}/out/mutation-r4.console`, 'utf8').match(/== mutation: (\d+)\/(\d+) killed; survivors: ?(.*)/);
const rr = (label) => (at(label) === 'PASS' ? '<span class="amber">reproduces</span>' : '<span class="pass">does not reproduce</span>');
figures['r4-01-matrix'] = page(
  'PR #13107 round 4 — 24b26f107d (#13037 merged in by /resolve)',
  'Head = main <code>6310dd38d5</code> (#13037) plus exactly the PR\'s 16 files. Java, Hosted Harness and Web Shell built from it; MySQL 8.4.7; headless Chromium. Arms: head, main without the PR, and the previous head 9522974f9d.',
  `<table><tr><th>check</th><th>result</th></tr>
   <tr><td>the 8 hand-resolved conflicts (remerge-diff read)</td><td>both sides kept; <code>pendingApproval</code> and <code>onToolResultOpen</code> both on <code>MessageList</code>; <code>action_updated</code> skip stays before the turn split</td></tr>
   ${st.map((l) => { const [k, v] = l.split(' exit='); return `<tr><td>${k}</td><td class="${v === '0' ? 'pass' : 'fail'}">exit ${v}</td></tr>`; }).join('')}
   <tr><td>unit tests, <code>client/components/managed</code> / whole <code>packages/web-shell</code></td><td class="pass">${vit('vitest-managed.log')[1]} / ${vit('vitest-managed.log')[2]} · ${vit('vitest-all.log')[1]} / ${vit('vitest-all.log')[2]}</td></tr>
   <tr><td>real-stack scenarios (rounds 1–3 + the itemId A/B)</td><td><span class="pass">${bp} / ${bp + bf}</span> — the 3 misses are the known R2-1 probe</td></tr>
   <tr><td>approval card ↔ tool row matching after #13037 (resolve bot\'s flag)</td><td><span class="amber">confirmed</span>: an itemId-keyed row is no longer matched; candidate +40/−3 restores it</td></tr>
   <tr><td>R1-1 (fixed in round 3)</td><td>${rr('[R1-1b] summary route failing + Refresh')}</td></tr>
   <tr><td>R1-2 · R1-3 · R1-4 · R1-5 · R1-6 · R1-8 (deferred)</td><td>${['[R1-2] the stale', '[R1-3] the', '[R1-4]', '[R1-5]', '[R1-6] after', '[R1-8]'].map(rr).join(' · ')}</td></tr>
   <tr><td>${mut[2]} source mutants</td><td><span class="amber">${mut[1]} / ${mut[2]} killed</span>; G9 (page half of R1-1) still survives — the round-3 candidate page test still applies, passes 31/31 and kills it</td></tr></table>`,
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
