// VERIFICATION RIG ONLY (PR #13112): lays the raw page screenshots and the result ledgers out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13112-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });

const X0 = 262;
const W = 918;
const strip = (name, y0, y1, h = 860) =>
  `<div class="strip" style="height:${y1 - y0}px;background-image:url('file://${RAW}/${name}.png');background-size:1180px ${h}px;background-position:-${X0}px -${y0}px"></div>`;
const shotBlock = (label, tone, strips, note = '', noteTone = '') =>
  `<div class="shot"><div class="label ${tone}">${label}</div>${strips.join('<div class="cut">⋯</div>')}${note ? `<div class="note ${noteTone}">${note}</div>` : ''}</div>`;

const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W + 56}px;padding:24px 28px 26px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 16px;line-height:1.45}
  .shot{margin:0 0 18px}
  .label{font-size:13px;font-weight:600;padding:6px 10px;border-radius:6px 6px 0 0;display:inline-block}
  .label.base{background:#3d1f22;color:#ffb3ad}.label.head{background:#173a25;color:#8fe3a8}.label.warn{background:#3d3112;color:#f2cc60}.label.info{background:#1b2a41;color:#9ecbff}
  .strip{width:${W}px;background-repeat:no-repeat;background-color:#fff;border:1px solid #30363d}
  .cut{width:${W}px;text-align:center;color:#6e7681;font-size:12px;line-height:14px;background:#161b22;border-left:1px solid #30363d;border-right:1px solid #30363d}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22;width:${W - 22}px}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:14px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}
  h2{font-size:14.5px;margin:14px 0 8px;color:#e6edf3}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const P = (t) => ({ c: 'pass', t });
const F = (t) => ({ c: 'fail', t });
const A = (t) => ({ c: 'amber', t });
const N = (t) => ({ c: 'num', t });

const figs = {};
figs['01-before-after'] = page(
  'Bound Session, creator view: main vs PR head',
  'Real Managed panel (vite, <code>ManagedAgentWebShell</code>) against the real Spring server, Hosted Harness and Runtime Broker on MySQL 8.4.7. Crops of unmodified screenshots.',
  shotBlock('main 51b80dad — creator (alice)', 'base', [strip('base-01-creator-bound-m1', 40, 372), strip('base-01-creator-bound-m1', 730, 860)], 'Before: the creator sees the initial Turn and no composer; a later Turn over REST returns <code>409 workspace_unavailable</code>.', 'bad') +
    shotBlock('PR head f2a028b — creator (alice), real model qwen3.8-max, three Turns', 'head', [strip('head-07-real-model-alice-en', 40, 700, 1100), strip('head-07-real-model-alice-en', 960, 1085, 1100)], 'After: Turn 2 (a later Turn) appended <code>beta-2604</code> to the same file, Turn 3 answered <code>alpha-7319</code> from the history. <b>F3:</b> the banner above still says “Message execution is not available in this service yet.”', 'ok') +
    shotBlock('PR head — reader (bob, read-only grant): still read-only', 'info', [strip('head-06-reader-bound-h1', 40, 175), strip('head-06-reader-bound-h1', 740, 860)], '<code>capabilities.workspaceTurns=false</code> for bob and carol (read+create but not the creator); submit, cancel and rename from them return <code>409 workspace_unavailable</code>.', 'ok'),
);
figs['02-cancel'] = page(
  'Cancel a running later Turn from the panel (PR head)',
  'The rig model holds its reply; the creator clicks “Cancel turn”. Service side: <code>turns/cancel</code> 202, Turn <code>CANCELLED</code> 452 ms later, the Harness aborted the model request, no tool ran, Workspace lease released, next Turn completes.',
  shotBlock('running later Turn — Cancel turn shown to the creator', 'head', [strip('head-03-creator-running-cancel-h1', 640, 860)]) +
    shotBlock('2.5 s after the click', 'head', [strip('head-04-creator-cancelled-h1', 640, 860)], 'The database had the Turn <code>CANCELLED</code> after 452 ms; the panel still showed “Cancelling” at 2.5 s (panel refresh lag).'),
);
fs.writeFileSync(`${OUT}/cards.json`, JSON.stringify(Object.keys(figs)));
export { figs, page, table, P, F, A, N, OUT };

if (process.argv[1].endsWith('figures.mjs')) {
  const extra = fs.existsSync(`${RIG}/probe/figures-tables.mjs`) ? (await import(`${RIG}/probe/figures-tables.mjs`)).default({ page, table, P, F, A, N }) : {};
  Object.assign(figs, extra);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  for (const [name, html] of Object.entries(figs)) {
    const f = `${OUT}/${name}.html`;
    fs.writeFileSync(f, html);
    await p.goto(`file://${f}`);
    await p.waitForTimeout(300);
    await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${OUT}/${name}.png`);
  }
  await browser.close();
}
