// VERIFICATION RIG ONLY (PR #13107): lays the raw page screenshots out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13107-rig';
const require = createRequire(`${RIG}/wt4/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out-r3`;
fs.mkdirSync(OUT, { recursive: true });

// Screenshots are 1180x860 CSS px at 2x. The conversation panel starts at x=262.
const X0 = 262;
const W = 918;
const strip = (name, y0, y1) =>
  `<div class="strip" style="height:${y1 - y0}px;background-image:url('file://${RAW}/${name}.png');background-position:-${X0}px -${y0}px"></div>`;
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
  `<div class="strip" style="height:${y1 - y0}px;background-image:url('file://${RAW}/${name}.png');background-position:-${x0}px -${y0}px"></div>`;

const L = (name) => fs.readFileSync(`${RIG}/out/r3db/${name}.log`, 'utf8');
const line = (name, re) => (L(name).match(re) ?? [])[1] ?? '';
figures['r3-01-r1-1-summary-outage'] = page(
  'R1-1 on the real stack: summary route failing + Refresh',
  '<code>sessions/get</code> answers 503 at the browser while <code>actions/query</code> stays healthy. Without a reload the card stays (the summary already loaded is kept); after Refresh the whole Session view is empty, not only the card.',
  shotBlock('after Refresh during the outage: the session error is shown, the Session view (transcript and card) is empty; 0 Actions reads in 15 s', 'warn', [stripAt('s11-r1-1b-summary-outage', 0, 20, 300)], 'The card came back 3.3 s after the summary route recovered (the summary poller runs every 3 s). The Turn waits meanwhile; if the outage outlasts the approval timeout, the Action expires and the model is told nobody answered. Nothing runs without an answer.'),
);
figures['r3-02-r1-2-ended-action'] = page(
  'R1-2 on the real stack: a stale tab answers an Action that already ended',
  'Tab A clicked "Yes, allow once"; the tool ran and the Turn completed. Tab B was not receiving stream events. Its "Reject" gets a real <code>409 action_already_resolved</code>.',
  shotBlock('tab B: the Session already reads Completed', 'warn', [strip('s11-r1-2-ended-action', 40, 140)]) +
    shotBlock('tab B: the card stays, with "Retry the same option"; a second click repeats the 409; nothing re-reads the list', 'warn', [strip('s11-r1-2-ended-action', 646, 852)]),
);
figures['r3-03-r1-3-stale-alert'] = page(
  'R1-3 on the real stack: an old answer error labels the next approval',
  'Approval 1 (write_file): the answer from this page failed once (503), then the owner answered it elsewhere. Approval 2 (edit) arrives next to the old alert.',
  shotBlock('approval 2 with the alert that belongs to approval 1', 'warn', [strip('s11-r1-3-stale-alert', 580, 852)]),
);
const rows = [
  ['R1-1', 'Critical', 'Refresh removes the live card; a failing summary route keeps it away with no Actions reads', 'Refresh: card gone for 16 ms (one summary round trip), buttons absent in the gap. Summary 503 + Refresh: no card and 0 Actions reads for 15 s while actions/query is healthy; card back 3.3 s after recovery. Without Refresh the card stays. The Session error is shown and the whole Session view is empty, not only the card', 'real, fails closed; I would rate it a Suggestion'],
  ['R1-2', 'Suggestion', 'an ended Action (409) is reported as unconfirmed, "retry the same option", no re-read', 'real 409 action_already_resolved from a stale tab after another tab allowed: card stays on a Completed Session; second click 409 again; 0 re-reads', 'confirmed'],
  ['R1-3', 'Suggestion', 'the answer error outlives its approval and labels the next one', 'approval 2 (edit) shown beside approval 1\'s "could not be confirmed"', 'confirmed'],
  ['R1-4', 'Suggestion', '"could not be loaded" beside a loaded card', 'one failed background re-read: banner beside the card, cleared 2 s later', 'confirmed, transient'],
  ['R1-5', 'Suggestion', 'a 4xx is retried like a 5xx; no server message', '404 → reads at ' + line('s11-review-findings-r1-5-r1-6-r1-8', /reads=4 at (\[[^\]]*\])/) + ' ms, then Retry; message not shown', 'confirmed'],
  ['R1-6', 'Suggestion', 'retry budget not reset when the reader comes back', 'ladder exhausted → Refresh → one more 503 → no retry, no card for 15 s while the service is healthy', 'confirmed'],
  ['R1-7', 'Suggestion', 'tool.title is read but never written', 'no title writer in managed-session-messages.ts; the card shows WriteFile / write_file', 'confirmed (code)'],
  ['R1-8', 'Suggestion', 'the unavailable notice is outside aria-describedby', 'aria-describedby → ["Apply this change?","write_file"]; the notice is a sibling', 'confirmed'],
  ['R1-9', 'Suggestion', 'TS2741 in three fixtures, no gate reports it', 'tsc over the test file: exactly 3 × TS2741 (lines 261, 295, 330); tsconfig excludes tests', 'confirmed'],
  ['R1-10..13', 'Suggestion', 'four coverage gaps', 'mutants for stream_gap, Session-switch reset, MessageList prop, answer-error clear: 0 / 4 killed (94/94 green)', 'confirmed'],
];
const P = (name) => { const m = L(name).trim().split('\n').at(-1).match(/(\d+) passed, (\d+) failed/); return [Number(m[1]), Number(m[2])]; };
const beh = ['s1-answer-allow', 's1-answer-deny-zh', 's2-load-base-expiry', 's3-multi', 's4-faults', 's5-sequence-files', 's5-sequence-batch', 's6-skew', 's8-load-retry', 's7-real-model-allow', 's7-real-model-deny', 's10-accepted-then-failed', 's9-tool-item-probe'];
let bp = 0, bf = 0; for (const n of beh) { const [p, f] = P(n); bp += p; bf += f; }
const st = fs.readFileSync(`${RIG}/out/static-r3/summary.log`, 'utf8').trim().split('\n').filter((l) => /exit=/.test(l));
const vit = (f) => fs.readFileSync(`${RIG}/out/static-r3/${f}`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(\d+) passed \((\d+)\)/);
figures['r3-04-matrix'] = page(
  'PR #13107 round 3 — e572cd72fc merged into main a4bf0026c0',
  'Local test-merge <code>218c678b17</code> (not pushed). Outside <code>packages/web-shell/client</code> it equals <code>main</code>; the PR\'s managed code is unchanged by the merge. Java, Harness and Web Shell all built from it; MySQL 8.4.7; headless Chromium.',
  `<table><tr><th>/review finding (review 5375002256)</th><th>claim</th><th>real stack</th><th>verdict</th></tr>${rows.map(([id, sev, claim, seen, v]) => `<tr><td><b>${id}</b><br><span class="${sev === 'Critical' ? 'fail' : 'amber'}">${sev}</span></td><td>${claim}</td><td>${seen}</td><td>${v}</td></tr>`).join('')}</table>
   <div style="height:14px"></div>
   <table><tr><th>regression on the merged build</th><th>result</th></tr>
   <tr><td>rounds 1–2 scenarios (allow, deny zh, before/after + expiry, viewers, faults, sequences, skew, load retry, real model ×2, accepted-then-failed, tool-item probe)</td><td><span class="pass">${bp} / ${bp + bf}</span> — the 3 misses are the known R2-1 probe (Java drops tool arguments)</td></tr>
   ${st.map((l) => { const [k, v] = l.split(' exit='); return `<tr><td>${k}</td><td class="${v === '0' ? 'pass' : 'fail'}">exit ${v}</td></tr>`; }).join('')}
   <tr><td>unit tests, <code>client/components/managed</code> / whole <code>packages/web-shell</code></td><td class="pass">${vit('vitest-managed.log')[1]} / ${vit('vitest-managed.log')[2]} · ${vit('vitest-all.log')[1]} / ${vit('vitest-all.log')[2]}</td></tr></table>`,
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
