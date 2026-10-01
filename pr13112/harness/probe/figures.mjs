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
figs['06-r2'] = page(
  'Round 2 — re-verified at 61ee97e0 (merge of main 57e720bc)',
  'The new head equals my round-1 trial merge (head ⊕ afb911a3) plus #13081’s web-shell trajectory files. Server classes are byte-identical to that build (0 differing .class files); the author’s conflict resolution is the one I tested. Everything was rebuilt from 61ee97e0 and re-run.',
  table(['Check on 61ee97e0', 'Result', 'vs round 1'], [
    ['managed-agent-server unit suite / HostedPublicWorkspaceIT on MySQL 8.4.7', P('281 / 281 · 2 / 2'), 'same'],
    ['web-shell eslint + prettier (6 PR files), tsc, managed vitest, generated types', P('clean · 77 / 77 · no diff'), 'same'],
    ['S1 later Turn / cancel / rename / lifecycle (REST + WebShell adapter)', P('51 / 51 (cancel → CANCELLED 236 ms)'), 'same'],
    ['S7 real Managed panel (Playwright)', P('7 / 7'), 'same (F3 banner still shown)'],
    ['S2 opt-in off · S3 approval mode default · S9 real model qwen3.8-max', P('6 / 6 · 15 / 15 · 5 / 5'), 'same'],
    ['F1 cancel vs authorization refusal (revoke / DRAINING)', F('202, COMPLETED, file written'), 'same'],
    ['F2 worker crash · Harness+Spring restart', F('3 / 3 fail 0.46 s · 30.9 / 30.5 s'), A('same; this time 8 workers survived as orphans, still failed')],
    ['F4 can_create revoked / DRAINING', A('workspaceTurns=true, 202 → FAILED in 23–26 ms'), 'same'],
    ['Bot R1-3 rename under revocation · R1-15 empty-Session rename', A('503 + PENDING block · Harness session created'), 'same'],
    ['Mutation, 18 mutants', A('14 / 18 (J2, J6, J14 survive; J11 equivalent)'), 'same'],
    ['candidate-tests.patch (+31, applies cleanly)', P('unit 19 / 19 · IT 2 / 2 · kills J2, J6, J14'), 'same'],
  ]) +
    shotBlock('new head — creator view (zh): composer enabled under the “暂未开放消息执行” banner', 'head', [strip('head-05-creator-zh-n1', 40, 175), strip('head-05-creator-zh-n1', 730, 860)]) +
    shotBlock('new head — running later Turn, Cancel turn shown to the creator', 'head', [strip('head-03-creator-running-cancel-n1', 640, 860)]),
);
figs['07-r3'] = page(
  'Round 3 — re-verified at 5d4499cf (five author commits) and on head ⊕ main 310f4ba3',
  'Server classes are byte-identical to round 2 except the OpenAPI resource; the web-shell banner changed. Everything rebuilt from 5d4499cf (and from the trial merge) and re-run on native MySQL 8.4.7.',
  table(['Item', 'On the real stack'], [
    ['F3 / R1-4 banner', P('fixed for the creator (both languages); reader still reads “not available in this service yet”')],
    ['R1-11 contract version', P('1.27.0 with a v1.27 entry')],
    ['R1-1 stale “remain gated” text', A('README + design docs fixed; OpenAPI createSession / webShellCreateSession and generated types :79 still say it')],
    ['R1-12 negative controls', P('mutation 17 / 18 killed by the PR’s own tests (J11 equivalent); J2, J6, J14 now killed')],
    ['R1-14 approvals-run later Turn', P('HostedPublicWorkspaceIT 2 / 2 in 5 runs (head ×4, three at load 40–55; head ⊕ main ×1) — 16 model requests and 8 answers hold')],
    ['unit · Hosted IT', P('head 281 / 281 · 2 / 2;  head ⊕ 310f4ba3 290 / 290 · 2 / 2')],
    ['web-shell eslint/prettier/tsc · managed vitest · generated types', P('clean · 77 / 77 · no diff')],
    ['S1 core · panel · approvals · real model', P('51 / 51 (also on head ⊕ main) · 7 / 7 · 15 / 15 · 5 / 5')],
    ['F1 cancel vs authorization refusal', F('unchanged: 202, COMPLETED, file written (head and head ⊕ main)')],
    ['F2 worker crash', F('unchanged: binding LOST, 3 / 3 hosted_turn_failed 0.7–0.9 s (head and head ⊕ main)')],
    ['F4 / R1-2 · R1-3 · R1-15 (declined)', A('unchanged: 202 → FAILED 277 ms · 503 + PENDING block · Harness session created')],
  ]) +
    shotBlock('creator (zh) on 5d4499cf — the “暂未开放消息执行” line is gone, composer enabled', 'head', [strip('head-05-creator-zh-p1', 40, 150), strip('head-05-creator-zh-p1', 730, 860)]) +
    shotBlock('reader (bob) on 5d4499cf — read-only; the line stays', 'info', [strip('head-06-reader-bound-p1', 40, 175)], 'For a reader the line now contradicts the transcript right below it (the creator’s Turns did run); wording such as “only the Session creator can send” would fit. Nit.'),
);
figs['08-r4'] = page(
  'Round 4 — re-verified at 485c92bc (26de98cd, 66646a6c, three main merges) and on head ⊕ main 0a5f518b',
  'Rebuilt from 485c92bc and from the trial merge (adds #13115); native MySQL 8.4.7, packaged Harness with #13131 (M2) and #13110 in. CI 19 / 19 green.',
  table(['Item', 'On the real stack'], [
    ['R1-1 contract text', P('fixed: createSession / webShellCreateSession describe the creator admission; only lifecycle/cwd still “remain gated”; contract 1.28.0')],
    ['F4 / R1-2 admission vs execution', P('fixed: can_create revoked or DRAINING → workspaceTurns=false, 409 in 5–6 ms, model never called')],
    ['R1-3 rename under revocation', P('fixed for grant/state refusals: 409, no PENDING command, no public event; rename after restore 200')],
    ['… residual: authorization fails after admission (Workspace generation moved)', A('submit 202 → FAILED 262 ms; rename 409 but PENDING stays → fresh keys get 409 session_operation_active until the original key is replayed')],
    ['F1 cancel while authorization is refused', A('now an honest 409 (was 202 then lost); the Turn still completes and writes once the grant returns; a lost POST /cancel is still never re-sent')],
    ['F2 Runtime worker gone', F('unchanged on head and head ⊕ main: crash → LOST, 3 / 3 fail 0.45 s; restart → 33.8 s, then 31.1 / 30.3 s')],
    ['R1-15 rename of an empty Session', A('unchanged (declined): Harness session created')],
    ['merge dc22300d (#13037 artifacts + workspaceTurns)', P('capability has both fields; contract 1.28.0 with v1.28 entry; tests green')],
    ['unit · Hosted IT', P('head 349 / 349 · 2 / 2;  head ⊕ 0a5f518b 350 / 350 · 2 / 2')],
    ['web-shell eslint/prettier/tsc · managed vitest · generated types', P('clean · 159 / 159 · no diff')],
    ['S1 core · panel · approvals · opt-in off · real model', P('51 / 51 (also head ⊕ main) · 7 / 7 · 15 / 15 · 6 / 6 · 5 / 5')],
    ['Mutation, 25 mutants on the new code', A('20 killed; K2, K6, J11 equivalent; K3 (opt-in clause) and K7 (rename refusal mapping) survive')],
    ['K3 on the stack (opt-in turned off after creation)', A('creator capability workspaceTurns=true while submit/cancel/rename all answer 409')],
  ]),
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
