// VERIFICATION RIG ONLY (PR #13107): lays the raw page screenshots out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13107-rig';
const require = createRequire(`${RIG}/wt3/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out-r2`;
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

const L = (name) => fs.readFileSync(`${RIG}/out/r2db/${name}.log`, 'utf8');
const pick = (name, re) => (L(name).match(re) ?? [])[1] ?? '';
figures['r2-01-before-after'] = page(
  'Same pending approval — base page vs PR page (e572cd72fc)',
  'Session <code>a6a60cf1</code> waits on a <code>write_file</code> approval (30 s timeout). Base = Web Shell of <code>main</code> at <code>78143fe335</code> (D6b merged); PR = <code>e572cd72fc</code>. Same Java server, same Harness.',
  shotBlock('BEFORE · base page: nothing to answer', 'base', [strip('s2-base-pending', 40, 285), strip('s2-base-pending', 620, 852)], 'The base page made 0 <code>actions/query</code> calls; 30 s later the approval expired unanswered.') +
    shotBlock('AFTER · PR page: the card, and the arguments-unavailable notice (the real Hosted path has no tool Item)', 'head', [strip('s2-head-pending', 40, 285), strip('s2-head-pending', 600, 852)]),
);
figures['r2-02-tool-item-probe'] = page(
  'If the Harness published the tool call, the arguments would still not reach the card',
  'The tap rewrote one real Harness SSE frame (id 6) into a <code>tool_call</code> session update carrying the call arguments. Everything after that is the real Java projector, store, WebShell adapter and page.',
  '<div class="shot"><div class="label info">what Java received from the Harness (frame id 6, excerpt)</div><pre>{"sessionUpdate":"tool_call","toolCallId":"probe-call-1","title":"WriteFile","status":"pending",\n "kind":"edit","name":"write_file",\n "rawInput":{"file_path":"probe.txt","content":"PROBE-ARGUMENT-BYTES-muoh04ju"},\n "input":{"file_path":"probe.txt","content":"PROBE-ARGUMENT-BYTES-muoh04ju"}, ...}</pre></div>' +
    '<div class="shot"><div class="label warn">what Java stored as the tool_call Item (managed_agent_item.attributes_json)</div><pre>' + pick('s9-tool-item-probe', /NOTE  stored Item attributes  -> (.*)/) + '</pre><div class="note">The projector copies only scalar <code>toolCallId</code>, <code>callId</code>, <code>title</code>, <code>status</code>, <code>name</code> (<code>HarnessEventProjector.safeToolData</code>, <code>HarnessEventProjector.java:77-85</code>). <code>rawInput</code> / <code>input</code> are dropped, so the page\'s <code>tool.args</code> is never set and the card would keep the unavailable notice.</div></div>' +
    shotBlock('the panel for that Session: the tool row exists, without arguments', 'warn', [strip('s9-tool-item-probe', 170, 370)]),
);
figures['r2-03-accepted-then-failed'] = page(
  'An answer the service accepts and then fails: "retry the same option" cannot work',
  'The tap answers the Harness <code>/actions/:id/resolve</code> call with 400, so Java ends the operation as <code>FAILED invalid_action_response</code> while the Action stays <code>requested</code>.',
  shotBlock('1 · live page, 13.5 s after "Yes, allow once" (202, operation pending → FAILED): no card, no message', 'warn', [strip('s10-1-stranded', 640, 852)]) +
    shotBlock('2 · after a reload the card is back; "Yes, allow once" replays the failed operation (202, status failed, replayed: true)', 'warn', [strip('s10-2-replay-loop', 590, 852)], 'The key <code>&lt;actionId&gt;:allow</code> is bound to the FAILED operation, so every retry of the same option replays <code>failed</code> — twice here, and again after the Harness recovered. Only "Reject" (a new key) got through. The message tells the owner to do the one thing that cannot work.'),
);
figures['r2-04-fixed'] = page(
  'Round-1 notes that the new head fixes, on the real stack',
  'Each strip is the PR page against the real service; failures are injected at the browser (503, 202 bodies) or observed from a real 403.',
  shotBlock('N1 · a reader answering gets 403 action_forbidden → creator-only message', 'head', [strip('s3-reader-refused', 590, 852)]) +
    shotBlock('load failure · four 503s: reads at ' + pick('s8-load-retry', /reads at (\[[^\]]*\]) ms/) + ' ms, then a Retry button', 'head', [strip('s8b-load-failed', 720, 852)]) +
    shotBlock('202 with status failed, injected at the browser (the service never saw that request) → the card stays with the unconfirmed-answer message', 'head', [strip('s4d-202-failed', 590, 852)]),
);
const tally = (name) => { const m = L(name).trim().split('\n').at(-1).match(/(\d+) passed, (\d+) failed/); return [Number(m[1]), Number(m[2])]; };
const rows = [
  ['s1-answer-allow', 'Live path: card arrives through the event stream; "Yes, allow once"; notice shown (no tool row)', ''],
  ['s1-answer-deny-zh', 'zh-CN, "拒绝": refusal reaches the model; notice localized', ''],
  ['s2-load-base-expiry', 'Before/after on one pending approval, then expiry with nobody answering', ''],
  ['s3-multi', 'Two owner tabs, a reader (403 → creator-only message), an answer through the public REST API', ''],
  ['s4-faults', '503; reply lost (same / other option); 202 failed; 202 recovery_blocked', ''],
  ['s5-sequence-files', 'write_file → edit → read_file in three model rounds', ''],
  ['s5-sequence-batch', 'Three write_file calls in one message: allow / reject / allow', ''],
  ['s6-skew', 'Browser clock ahead of the expiry: re-reads while waiting', ''],
  ['s8-load-retry', 'First read fails once / four times: background retries, Retry button', ''],
  ['s7-real-model-allow', 'Real model qwen3.8-max, allow', ''],
  ['s7-real-model-deny', 'Real model qwen3.8-max, reject', ''],
  ['s10-accepted-then-failed', 'Answer accepted (202) then FAILED server-side; reload; retry the same option', ''],
  ['s9-tool-item-probe', 'Harness frame rewritten into a tool_call with arguments → real Java → page', 'R2-1 ×3'],
];
let P = 0, F = 0;
const body = rows.map(([name, what, why]) => { const [p, f] = tally(name); P += p; F += f; return `<tr><td><code>${name}</code></td><td>${what}</td><td class="num"><span class="pass">${p}</span> / ${p + f}</td><td>${f ? `<span class="amber">${why}</span>` : '<span class="pass">all</span>'}</td></tr>`; }).join('');
const st = fs.readFileSync(`${RIG}/out/static-r2/summary.log`, 'utf8').trim().split('\n').filter((l) => /exit=/.test(l));
const vit = (f) => fs.readFileSync(`${RIG}/out/static-r2/${f}`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/);
const mut = fs.readFileSync(`${RIG}/out/mutation-r2.console`, 'utf8').match(/== mutation: (\d+)\/(\d+) killed; survivors: ?(.*)/);
const vm = vit('vitest-managed.log');
const va = vit('vitest-all.log');
figures['r2-05-matrix'] = page(
  'PR #13107 @ e572cd72fc — round 2',
  'Real stack on macOS: MySQL 8.4.7 · Spring server jar + embedded Runtime Broker (JDK 21) · packaged Hosted Harness · Web Shell served by vite · headless Chromium. Java and Harness built from <code>e572cd72fc</code>; outside <code>packages/web-shell/client</code> it is identical to <code>main</code> <code>78143fe335</code> (0 diff lines).',
  `<table><tr><th>scenario</th><th>what it drives through the real Managed panel</th><th>checks</th><th>misses</th></tr>${body}<tr><td><b>total</b></td><td></td><td class="num"><span class="pass">${P}</span> / ${P + F}</td><td><span class="amber">R2-1 ×3</span></td></tr></table>
   <div style="height:14px"></div>
   <table><tr><th>static gate (clean worktree of e572cd72fc)</th><th>result</th></tr>
   ${st.filter((l) => !/whole web-shell/.test(l)).map((l) => { const [k, v] = l.split(' exit='); return `<tr><td>${k}</td><td class="${v === '0' ? 'pass' : 'fail'}">exit ${v}</td></tr>`; }).join('')}
   <tr><td>unit tests, <code>client/components/managed</code></td><td class="pass">${vm[2]} / ${vm[3]}</td></tr>
   <tr><td>unit tests, whole <code>packages/web-shell</code></td><td><span class="amber">${va[2]} / ${va[3]}</span> — 2 failures in files this PR does not touch; both passed on an isolated rerun (see report)</td></tr>
   <tr><td>${mut[2]} source mutants of the new client code vs the PR's tests</td><td><span class="pass">${mut[1]} / ${mut[2]} killed</span> — survivors ${mut[3]}</td></tr></table>`,
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
