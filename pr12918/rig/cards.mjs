// Render evidence cards (HTML -> Playwright element screenshot, 2x).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SP } from './lib.mjs';

const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');
const OUT = path.join(SP, 'cards');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = path.join(SP, 'shots');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:900px}
h1{font-size:22px;margin:0 0 4px 0;color:#f0f6fc}
.sub{font-size:14px;color:#8b949e;margin-bottom:18px}
.lbl{font:600 13px Menlo,monospace;margin:14px 0 6px 0}
.base{color:#f85149}.head{color:#3fb950}.warn{color:#d29922}.dim{color:#8b949e}
.crop{position:relative;overflow:hidden;border:1px solid #30363d;border-radius:8px}
.crop img{position:absolute}
pre{font:13px/1.5 Menlo,monospace;margin:6px 0 0 0;white-space:pre;color:#c9d1d9}
table{border-collapse:collapse;font:13px Menlo,monospace}
td,th{border:1px solid #30363d;padding:5px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600}
td.ok{color:#3fb950}td.bad{color:#f85149}td.w{color:#d29922}
`;
function crop(file, { x, y, w, h, scale = 0.5, natW = 2560 }) {
  const src = 'file://' + path.join(SHOTS, file);
  return `<div class="crop" style="width:${w}px;height:${h}px"><img src="${src}" style="width:${natW * scale}px;left:${-x}px;top:${-y}px"></div>`;
}

const cards = {};

cards['01-webshell-after-restart'] = `
<h1>Real Web Shell, after a daemon restart</h1>
<div class="sub">Session selected Full Access via POST /session/:id/approval-mode {mode:"yolo"} (no persist) · final client detached · daemon stopped and restarted · opened the session in the bundled Web Shell (which issues the cold load)</div>
<div class="lbl base">base dcc984cf66 &nbsp; POST /session/:id/load → attached:false, state.modes.currentModeId:"default"</div>
${crop('webshell-base-full.png', { x: 270, y: 618, w: 1010, h: 140 })}
<div class="lbl head">PR d1c1a8fd73 &nbsp; POST /session/:id/load → attached:false, state.modes.currentModeId:"yolo"</div>
${crop('webshell-head-full.png', { x: 270, y: 618, w: 1010, h: 140 })}
`;

const H = JSON.parse(fs.readFileSync(path.join(SP, 'runs/suite-head/results.json'), 'utf8')).phases;
const B = JSON.parse(fs.readFileSync(path.join(SP, 'runs/suite-base/results.json'), 'utf8')).phases;
const P2H = JSON.parse(fs.readFileSync(path.join(SP, 'runs/probe2-head/results.json'), 'utf8'));
const P2B = JSON.parse(fs.readFileSync(path.join(SP, 'runs/probe2-base/results.json'), 'utf8'));
const m = (v) => v?.currentModeId ?? v?.live ?? JSON.stringify(v);
const wf = (v) => `${v.permissionRequests} perm req · file ${v.fileExists ? 'written' : 'absent'}`;
const rows = [
  ['1', 'cold load after final detach (A: yolo)', m(B.p1['S1.A.coldLoad']), m(H.p1['S1.A.coldLoad']), 'yolo'],
  ['1', 'other session B (never changed), live', m(B.p1['S1.B.live']), m(H.p1['S1.B.live']), 'default'],
  ['1', 'real write_file on A after cold load', wf(B.p1['S1.A.writeFile']), wf(H.p1['S1.A.writeFile']), '0 perm req · file written'],
  ['1', 'unchanged workspace reload, then cold load', m(B.p1['S2.A.afterReload.cold']), m(H.p1['S2.A.afterReload.cold']), 'yolo'],
  ['1', 'daemon restart → load A / B', `${m(B.p2['S1.A.afterRestart'])} / ${m(B.p2['S1.B.afterRestart'])}`, `${m(H.p2['S1.A.afterRestart'])} / ${m(H.p2['S1.B.afterRestart'])}`, 'yolo / default'],
  ['1', 'Web Shell create {approvalMode:yolo} + prompt, cold', m(P2B['a.createWithYolo.coldLoad']), m(P2H['a.createWithYolo.coldLoad']), 'yolo'],
  ['2', 'yolo → Plan, restart → load', m(B.p2['S3.C.afterRestart']), `${m(H.p2['S3.C.afterRestart'])}`, 'plan'],
  ['2', 'approved exit_plan_mode "restore previous"', m(B.p2['S3.C.modeAfterApprovedExit']) + (B.p2['S3.C.exitPlan'].perms ? '' : ' (not in Plan)'), m(H.p2['S3.C.modeAfterApprovedExit']), 'yolo'],
  ['2', 'Plan + execution auto-edit, restart → load', m(B.p2['S4.D.afterRestart']), `${m(H.p2['S4.D.afterRestart'])} exec=${H.p2['S4.D.afterRestart'].planExecutionMode}`, 'plan exec=auto-edit'],
  ['2', 'approved exit uses execution policy', m(B.p2['S4.D.modeAfterApprovedExit']), m(H.p2['S4.D.modeAfterApprovedExit']), 'auto-edit'],
  ['3', 'yolo recorded, load {approvalMode:default}', m(B.p1['S5.E.coldLoad.override=default']), m(H.p1['S5.E.coldLoad.override=default']), 'default'],
  ['3', '… then cold load w/o override / restart', `${m(B.p1['S5.E.coldLoad.noOverride'])} / ${m(B.p2['S5.E.afterRestart'])}`, `${m(H.p1['S5.E.coldLoad.noOverride'])} / ${m(H.p2['S5.E.afterRestart'])}`, 'default / default'],
  ['3', 'F=auto-edit; G persist:true yolo; F cold', m(B.p5['S6.F.coldLoad']), m(H.p5['S6.F.coldLoad']), 'auto-edit'],
  ['3', 'workspace settings / new session H', `${B.p5['S6.workspaceSettings'].tools.approvalMode} / ${m(B.p5['S6.H.newSession'])}`, `${H.p5['S6.workspaceSettings'].tools.approvalMode} / ${m(H.p5['S6.H.newSession'])}`, 'yolo / yolo'],
  ['4', 'untrusted restart → load A (yolo recorded)', m(B.p3['S9.A.untrustedLoad']), m(H.p3['S9.A.untrustedLoad']), 'default'],
  ['4', 'real write_file, rejected', wf(B.p3['S9.A.writeFile']), wf(H.p3['S9.A.writeFile']), '1 perm req · file absent'],
  ['4', 'untrusted: Plan(pre=yolo) → approved exit', m(B.p3['S9b.C2.modeAfterApprovedExit']), `${m(H.p3['S9b.C2.untrustedLoad'])} → ${m(H.p3['S9b.C2.modeAfterApprovedExit'])}`, 'never yolo'],
  ['4', 'QWEN_CODE_SAFE_MODE=1 restart → load A2', m(B.p4['S10.A2.safeModeLoad']), m(H.p4['S10.A2.safeModeLoad']), 'default'],
  ['4', '… normal restart → load A2 again', m(B.p5['S10.A2.normalLoadAfterSafe']), m(H.p5['S10.A2.normalLoadAfterSafe']), 'yolo'],
  ['5', 'unused session → transcript file', String(B.p1['S7.U0.noActivity.jsonl']), String(H.p1['S7.U0.noActivity.jsonl']), 'null'],
  ['5', 'trailing bogus + Plan(pre=Plan) records', m(B.p5['S11.A3.invalidTailLoad']), m(H.p5['S11.A3.invalidTailLoad']), 'yolo'],
  ['5', 'jsonl read-only during set-mode', `HTTP ${B.p5['S12.W.setModeWhileReadOnly'].status} · live ${m(B.p5['S12.W.live'])}`, `HTTP ${H.p5['S12.W.setModeWhileReadOnly'].status} · live ${m(H.p5['S12.W.live'])} · recording_degraded`, '200 · live yolo'],
  ['—', 'rewind to turn 1 (live auto-edit), cold', m(B.p1['S8.RW.coldLoad']), m(H.p1['S8.RW.coldLoad']), 'auto-edit'],
];
const OKS = { 'never yolo': (v) => !/yolo/.test(v), '200 · live yolo': (v) => /HTTP 200 · live yolo/.test(v) };
const cls = (v, exp) => ((OKS[exp] ? OKS[exp](String(v)) : String(v) === exp) ? 'ok' : 'bad');
cards['02-ab-matrix'] = `
<h1>A/B on the real bundled daemon: base dcc984cf66 vs PR d1c1a8fd73</h1>
<div class="sub">qwen serve from dist/cli.js · isolated HOME/QWEN_HOME · standalone fake OpenAI model (separate process, request ledger) · user default tools.approvalMode=default · # = PR test-plan item</div>
<table><tr><th>#</th><th>scenario</th><th>base</th><th>PR</th><th>expected</th></tr>
${rows.map(([n, s, b, h, e]) => `<tr><td class="dim">${n}</td><td>${esc(s)}</td><td class="${cls(b, e)}">${esc(b)}</td><td class="${cls(h, e)}">${esc(h)}</td><td class="dim">${esc(e)}</td></tr>`).join('\n')}
</table>`;

cards['03-empty-sessions-listed'] = `
<h1>Finding: POST /session with an explicit approvalMode now writes a transcript at creation</h1>
<div class="sub">1 real prompted session + 2 sessions created with {"approvalMode":"yolo"} / {"approvalMode":"auto-edit"} and never prompted · clients detached · Web Shell reloaded</div>
<div style="display:flex;gap:28px">
<div><div class="lbl head">base dcc984cf66 — no file, not listed</div>${crop('empty-base-full.png', { x: 0, y: 388, w: 205, h: 138 })}</div>
<div><div class="lbl warn">PR d1c1a8fd73 — 2 empty entries, titled by id</div>${crop('empty-head-full.png', { x: 0, y: 388, w: 205, h: 138 })}</div>
<div><div class="lbl warn">PR: 2d84376c….jsonl = exactly 1 line</div>
<pre>{"uuid":…,"parentUuid":null,"sessionId":…,"timestamp":…,
 "type":"system","provenance":"system","cwd":…,"version":…,
 "subtype":"session_approval_mode",
 "systemPayload":{"mode":"yolo"}}</pre>
<pre class="dim">PR body / design: "A session with no activity still
creates no transcript" · "Creation and cold restore
remain read-only"</pre></div>
</div>`;

const only = process.argv.slice(2);
const extra = fs.existsSync(path.join(SP, 'rig', 'cards-extra.json'))
  ? JSON.parse(fs.readFileSync(path.join(SP, 'rig', 'cards-extra.json'), 'utf8'))
  : {};
Object.assign(cards, extra);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
for (const [name, body] of Object.entries(cards)) {
  if (only.length && !only.includes(name)) continue;
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card">${body}</div>`);
  await page.goto('file://' + file);
  await page.waitForTimeout(300);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await page.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, 'clippedPre=', clipped);
}
await browser.close();
