// VERIFICATION RIG ONLY (PR #13107): lays the raw page screenshots out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13107-rig';
const require = createRequire(`${RIG}/wt4/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out-r3h`;
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


const L = (name) => fs.readFileSync(`${RIG}/out/r3h/${name}.log`, 'utf8');
const L0 = (name) => fs.readFileSync(`${RIG}/out/r3db/${name}.log`, 'utf8');
const line = (txt, re) => (txt.match(re) ?? [])[1] ?? '';
figures['r3h-02-r1-1-before-after'] = page(
  'R1-1: summary route failing (503) + Refresh — before and after the fix',
  'Same probe both times: <code>sessions/get</code> answers 503 at the browser, <code>actions/query</code> stays healthy, the owner clicks Refresh.',
  shotBlock('BEFORE · e572cd72fc (merged into main): the Session view is empty and the card is gone; 0 Actions reads for 15 s', 'base', [stripAt('/Users/wenshao/pr13107-rig/bundle-r3/pr13107/r3/s11-r1-1b-summary-outage', 0, 20, 300)]) +
    shotBlock('AFTER · 9522974f9d: the card is kept and stays answerable; "Yes, allow once" reached the service and the tool ran once', 'head', [stripAt('s12-b-outage-card-kept', 0, 20, 150), strip('s12-b-outage-card-kept', 640, 852)]),
);
figures['r3h-03-r1-2-ended-action'] = page(
  'R1-2 (deferred): a stale tab answers an Action that already ended',
  'Tab A clicked "Yes, allow once"; the tool ran and the Turn completed. Tab B was not receiving stream events; its "Reject" gets a real <code>409 action_already_resolved</code>.',
  shotBlock('tab B: the Session already reads Completed', 'warn', [strip('s11-r1-2-ended-action', 40, 140)]) +
    shotBlock('tab B: the card stays with "Retry the same option"; a second click repeats the 409; nothing re-reads the list', 'warn', [strip('s11-r1-2-ended-action', 646, 852)]),
);
figures['r3h-04-r1-3-stale-alert'] = page(
  'R1-3 (deferred): an old answer error labels the next approval',
  'Approval 1 (write_file): the answer from this page failed once (503), then it was answered elsewhere. Approval 2 (edit) arrives next to approval 1\'s alert.',
  shotBlock('approval 2 beside the alert that belongs to approval 1', 'warn', [strip('s11-r1-3-stale-alert', 580, 852)]),
);
figures['r3h-05-kept-card-stale'] = page(
  'A side effect of keeping the card: it can go stale while the summary is unknown',
  'During the same summary outage the owner answered the Action through the REST API. The kept card has no way to learn that (no reads while the capability is unknown).',
  shotBlock('the kept card: "Yes, allow once" gets 409 action_already_resolved and the R1-2 message; nothing ran', 'warn', [stripAt('s12-c-stale-card-409', 0, 20, 150), strip('s12-c-stale-card-409', 640, 852)], 'After the summary route recovered the card left 1.8 s later, but the "could not be confirmed" alert stayed with no card (R1-3). Fails closed.'),
);
const P = (txt) => { const m = txt.trim().split('\n').at(-1).match(/(\d+) passed, (\d+) failed/); return [Number(m[1]), Number(m[2])]; };
const beh = ['s1-answer-allow', 's1-answer-deny-zh', 's2-load-base-expiry', 's3-multi', 's4-faults', 's5-sequence-files', 's5-sequence-batch', 's6-skew', 's8-load-retry', 's7-real-model-allow', 's7-real-model-deny', 's10-accepted-then-failed', 's12-r1-1-fix', 's9-tool-item-probe'];
let bp = 0, bf = 0; for (const n of beh) { const [p, f] = P(L(n)); bp += p; bf += f; }
const at = (txt, label) => (txt.split('\n').find((l) => l.includes(label)) ?? '').slice(0, 4);
const s11h = L('s11-review-findings');
const s11e = ['s11-review-findings-r1-1a-r1-1b', 's11-review-findings-r1-2-r1-3-r1-4', 's11-review-findings-r1-5-r1-6-r1-8'].map(L0).join('\n');
const mark = (v) => v === 'PASS' ? '<span class="amber">reproduces</span>' : v === 'FAIL' ? '<span class="pass">no longer reproduces</span>' : v;
const rows = [
  ['R1-1', 'Critical', 'a reload or a failing summary route removes the live card', at(s11e, '[R1-1b] summary route failing + Refresh'), at(s11h, '[R1-1b] summary route failing + Refresh'), '<b>fixed</b> (5751b86f18): healthy Refresh has no gap; a click during the reload window is delivered; during a summary outage the card stays and its answer reaches the service'],
  ['R1-2', 'Suggestion', 'an ended Action (409) reads as unconfirmed, "retry the same option", no re-read', at(s11e, '[R1-2] the stale'), at(s11h, '[R1-2] the stale'), 'deferred to #12867'],
  ['R1-3', 'Suggestion', 'the answer error outlives its approval and labels the next one', at(s11e, '[R1-3] the'), at(s11h, '[R1-3] the'), 'deferred'],
  ['R1-4', 'Suggestion', '"could not be loaded" beside a loaded card', at(s11e, '[R1-4]'), at(s11h, '[R1-4]'), 'deferred; transient (2 s)'],
  ['R1-5', 'Suggestion', 'a 4xx is retried like a 5xx; no server message', at(s11e, '[R1-5]'), at(s11h, '[R1-5]'), 'deferred'],
  ['R1-6', 'Suggestion', 'the retry budget is not reset when reads resume', at(s11e, '[R1-6] after'), at(s11h, '[R1-6] after'), 'deferred; the R1-1 fix does not change it'],
  ['R1-7', 'Suggestion', 'tool.title is read but never written', '—', '—', 'confirmed in code; deferred'],
  ['R1-8', 'Suggestion', 'the notice is outside aria-describedby', at(s11e, '[R1-8]'), at(s11h, '[R1-8]'), 'deferred'],
  ['R1-9', 'Suggestion', 'TS2741 in three test fixtures', '—', '—', 'confirmed with tsc (lines 261, 295, 330); deferred'],
  ['R1-10..13', 'Suggestion', 'four coverage gaps', '—', '—', 'confirmed: 0/4 mutants killed; deferred'],
];
const st = fs.readFileSync(`${RIG}/out/static-r3b/summary.log`, 'utf8').trim().split('\n').filter((l) => /exit=/.test(l));
const vit = (f) => fs.readFileSync(`${RIG}/out/static-r3b/${f}`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(\d+) passed \((\d+)\)/);
const mut = fs.readFileSync(`${RIG}/out/mutation-r3b.console`, 'utf8').match(/== mutation: (\d+)\/(\d+) killed; survivors: ?(.*)/);
figures['r3h-01-matrix'] = page(
  'PR #13107 round 3 — /review findings on the real stack, and the head 9522974f9d',
  'Columns: the probe on <code>e572cd72fc</code> merged locally into main (<code>218c678b17</code>), and on the current head <code>9522974f9d</code> (main <code>0a4bed5c9f</code> + the R1-1 fix). Real MySQL, Java, Hosted Harness, Web Shell, Chromium.',
  `<table><tr><th>finding</th><th>claim</th><th>e572 merged</th><th>9522974f</th><th>status</th></tr>${rows.map(([id, sev, claim, b, a, v]) => `<tr><td><b>${id}</b><br><span class="${sev === 'Critical' ? 'fail' : 'amber'}">${sev}</span></td><td>${claim}</td><td>${mark(b)}</td><td>${mark(a)}</td><td>${v}</td></tr>`).join('')}</table>
   <div style="height:14px"></div>
   <table><tr><th>at 9522974f9d</th><th>result</th></tr>
   <tr><td>rounds 1–2 scenarios + R1-1 fix probes (allow, deny zh, before/after + expiry, viewers, faults, sequences, skew, load retry, real model ×2, accepted-then-failed, reload/outage/switch, tool-item probe)</td><td><span class="pass">${bp} / ${bp + bf}</span> — the 3 misses are the known R2-1 probe (Java drops tool arguments)</td></tr>
   ${st.map((l) => { const [k, v] = l.split(' exit='); return `<tr><td>${k}</td><td class="${v === '0' ? 'pass' : 'fail'}">exit ${v}</td></tr>`; }).join('')}
   <tr><td>unit tests, <code>client/components/managed</code> / whole <code>packages/web-shell</code></td><td class="pass">${vit('vitest-managed.log')[1]} / ${vit('vitest-managed.log')[2]} · ${vit('vitest-all.log')[1]} / ${vit('vitest-all.log')[2]}</td></tr>
   <tr><td>${mut[2]} source mutants (incl. three R1-1 regressions)</td><td><span class="amber">${mut[1]} / ${mut[2]} killed</span>; reverting the page half of the R1-1 fix (G9) survives — a 41-line candidate page test kills it</td></tr></table>`,
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
