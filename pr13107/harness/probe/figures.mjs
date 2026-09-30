// VERIFICATION RIG ONLY (PR #13107): lays the raw page screenshots out as evidence figures.
// Every image region is an unmodified crop of a screenshot taken by the scenario scripts.
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13107-rig';
const require = createRequire(`${RIG}/wt2/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out`;
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
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;

const figures = {
  '01-before-after': page(
    'Same Session, same pending approval — base page vs PR page',
    'Session <code>be72fff3</code> waits on a <code>write_file</code> approval (30 s timeout). Both pages open it by URL against the same Java server. Base = Web Shell of #13101 head <code>358212a8b2</code>; PR = <code>b784842050</code>.',
    shotBlock('BEFORE · base page: nothing to answer, the Turn just reads "Thinking / responding"', 'base', [strip('s2-base-pending', 40, 285), strip('s2-base-pending', 620, 852)], 'The base page made 0 <code>actions/query</code> calls. 30 s later the approval expired unanswered and the model was told nobody answered.') +
      shotBlock('AFTER · PR page: the shared approval card, shown 15 ms after load', 'head', [strip('s2-head-pending', 40, 285), strip('s2-head-pending', 620, 852)]),
  ),
  '02-real-model-blind': page(
    'Real model (qwen3.8-max): the approval works, but the card says only "WriteFile"',
    'The owner asked for a specific file. The model called <code>write_file</code>; the Turn waits on the card. Nothing in the panel shows the path or the content that will be written.',
    shotBlock('1 · pending — what the owner sees before answering', 'warn', [strip('s7-real-allow-1-pending', 40, 330), strip('s7-real-allow-1-pending', 620, 852)], 'For this Session the service holds <b>0</b> <code>tool_call</code> Items and <b>0</b> <code>item.tool_call.updated</code> events (before and after the answer), so the page has no tool row to attach the card to and no arguments to show.') +
      shotBlock('2 · after "Yes, allow once" — the Turn continues and the file is written', 'head', [strip('s7-real-allow-2-after', 40, 420)], 'On disk: <code>real-allow-muo5sx90.md</code> = <code>reviewed by the session owner\\n</code>. With "Reject" (separate run) the file is absent and the model reports the denial.'),
  ),
  '03-batch-identical': page(
    'One model message with three write_file calls → three identical cards',
    'Approvals are asked one at a time in call order. The three cards are character-for-character the same, so the owner cannot tell which file each one is about.',
    shotBlock('prompt (scripted model): three files a / b / c', 'info', [strip('s5-batch-1-allow', 40, 285)]) +
      shotBlock('approval 1 · call <code>rig-call-0-0</code> → writes …-a.txt · owner clicked "Yes, allow once"', 'warn', [strip('s5-batch-1-allow', 636, 760)]) +
      shotBlock('approval 2 · call <code>rig-call-0-1</code> → writes …-b.txt · owner clicked "Reject"', 'warn', [strip('s5-batch-2-deny', 636, 760)]) +
      shotBlock('approval 3 · call <code>rig-call-0-2</code> → writes …-c.txt · owner clicked "Yes, allow once"', 'warn', [strip('s5-batch-3-allow', 636, 760)], 'Result on disk matches the clicks (a and c written, b not) — the mechanism is right; the information to decide is missing.'),
  ),
  '04-zh-deny': page(
    'Localized card (zh-CN) and the deny path',
    'The stable option IDs <code>allow</code>/<code>deny</code> are mapped to the shared option kinds, so labels follow the page language.',
    shotBlock('pending · 写入文件 / 拒绝 / 是，允许一次', 'head', [strip('s1-deny-zh-1-pending', 40, 285), strip('s1-deny-zh-1-pending', 620, 852)]) +
      shotBlock('after 拒绝 · the model receives the refusal as the tool result; no file, 0 tool executions', 'head', [strip('s1-deny-zh-2-after', 40, 400)]),
  ),
  '05-edges': page(
    'Two edges of the answer path',
    'Both are narrow; neither loses data. Shown so the wording can be judged.',
    shotBlock('a reader (may read the Session, did not create it) sees the card; answering returns 403 <code>action_forbidden</code>, rendered as a retryable send failure', 'warn', [strip('s3-reader-refused', 590, 852)], 'Retrying can never succeed for this viewer. The card leaves when the owner answers.') +
      shotBlock('lost reply: "Yes, allow once" was committed by the service, the browser never got the 202, delivery to the Harness was slow (8 s injected)', 'warn', [strip('s4c-card-back-after-lost-allow', 590, 852)], 'The card returns saying the answer "could not be sent". Clicking the same option replays the operation (<code>replayed: true</code>). Clicking "Reject" instead is accepted with 202, then fails server-side with <code>action_already_resolved</code>; the tool runs and the page shows nothing about it.'),
  ),
};

// ---- 06: result matrix, numbers read from the on-disk logs
const tally = (name) => {
  const last = fs.readFileSync(`${RIG}/out/ui2/${name}.log`, 'utf8').trim().split('\n').at(-1);
  const m = last.match(/(\d+) passed, (\d+) failed/);
  return [Number(m[1]), Number(m[2])];
};
const rows = [
  ['s1-answer-allow', 'Live path, scripted model: page open first, card arrives through the event stream, "Yes, allow once"', 'F1 ×2'],
  ['s1-answer-deny-zh', 'Same in zh-CN, "拒绝": refusal reaches the model, no file, 0 executions', 'F1 ×2'],
  ['s2-load-base-expiry', 'Before/after on one pending approval (page-load path), then expiry with nobody answering', ''],
  ['s3-multi', 'Two owner tabs + a reader + an answer through the public REST API', ''],
  ['s4-faults', '503 once; reply lost after commit (same option, other option)', ''],
  ['s5-sequence-files', 'write_file → edit → read_file in three model rounds', 'F1 ×2'],
  ['s5-sequence-batch', 'Three write_file calls in one model message: allow / reject / allow', 'F1 ×4'],
  ['s6-skew', 'Re-reads of the Action list while waiting; browser clock in step vs ahead', 'N3 ×1'],
  ['s7-real-model-allow', 'Real model qwen3.8-max, natural-language request, allow', ''],
  ['s7-real-model-deny', 'Real model qwen3.8-max, natural-language request, reject', ''],
];
let P = 0;
let F = 0;
const body = rows
  .map(([name, what, why]) => {
    const [p, f] = tally(name);
    P += p;
    F += f;
    return `<tr><td><code>${name}</code></td><td>${what}</td><td class="num"><span class="pass">${p}</span> / ${p + f}</td><td>${f ? `<span class="amber">${why}</span>` : '<span class="pass">all</span>'}</td></tr>`;
  })
  .join('');
const mut = (file) => fs.readFileSync(`${RIG}/out/${file}`, 'utf8').match(/== mutation: (\d+)\/(\d+) killed; survivors: ?(.*)/);
const m0 = mut('mutation-b784842050.console');
const m1 = mut('mutation-candidate.console');
const st = fs.readFileSync(`${RIG}/out/static-head3/summary.log`, 'utf8').trim().split('\n').filter((l) => /exit=/.test(l));
const vit = (f) => fs.readFileSync(`${RIG}/out/static-head3/${f}`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(\d+) passed \((\d+)\)/);
figures['06-matrix'] = page(
  'PR #13107 @ b784842050 — what was run',
  'Real stack on macOS: MySQL 8.4.7 · Spring server jar + embedded Runtime Broker (JDK 21) · packaged Hosted Harness <code>dist/cli.js</code> · Web Shell sources served by vite · headless Chromium (Playwright 1.61.1). Java and Harness were built from <code>cd7d6c61ab</code>; <code>b784842050</code> differs from it only in two files under <code>packages/web-shell/client</code>.',
  `<table><tr><th>scenario</th><th>what it drives through the real Managed panel</th><th>checks</th><th>misses</th></tr>${body}<tr><td><b>total</b></td><td></td><td class="num"><span class="pass">${P}</span> / ${P + F}</td><td><span class="amber">F1 ×10, N3 ×1</span></td></tr></table>
   <div style="height:14px"></div>
   <table><tr><th>static gate (pristine worktree of b784842050)</th><th>result</th></tr>
   ${st.map((l) => { const [k, v] = l.split(' exit='); return `<tr><td>${k}</td><td class="${v === '0' ? 'pass' : 'fail'}">exit ${v}</td></tr>`; }).join('')}
   <tr><td>unit tests, <code>client/components/managed</code></td><td class="pass">${vit('vitest-managed.log')[1]} / ${vit('vitest-managed.log')[2]}</td></tr>
   <tr><td>unit tests, whole <code>packages/web-shell</code></td><td class="pass">${vit('vitest-all.log')[1]} / ${vit('vitest-all.log')[2]}</td></tr>
   <tr><td>31 source mutants of the new client code vs the PR's tests</td><td><span class="amber">${m0[1]} / ${m0[2]} killed</span> — survivors ${m0[3]}</td></tr>
   <tr><td>same mutants with the 5 candidate tests (+127 lines, tests only)</td><td><span class="pass">${m1[1]} / ${m1[2]} killed</span> — survivors ${m1[3]}</td></tr></table>`,
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
