// VERIFICATION RIG ONLY (PR #13163 R5): lays the raw WebShell screenshots (fig/raw, unmodified) out as one figure.
// Each panel shows two unscaled-ratio crops of one screenshot: the Session header + binding card, and the running card + Cancel control.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/root/git/v13163-head/package.json');
const { chromium } = require('playwright');
const RAW = path.resolve('raw');
const W = 900, SRC = 2360, X0 = 507, CW = SRC - X0, S = W / CW;
const crop = (file, y0, y1, x0 = X0) => `<div class="crop" style="width:${W}px;height:${Math.round((y1 - y0) * S)}px;background-image:url('file://${RAW}/${file}.png');background-size:${Math.round(SRC * S)}px auto;background-position:-${Math.round(x0 * S)}px -${Math.round(y0 * S)}px"></div>`;
const panel = (label, cls, file, parts) => `<div class="panel"><div class="label ${cls}">${label}</div>${parts.map(([a, b, x]) => crop(file, a, b, x)).join('<div class="gap">⋯</div>')}</div>`;
const css = `body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI","Noto Sans CJK SC",sans-serif;color:#e6edf3}
#card{width:${W + 48}px;padding:20px 24px}
h1{font-size:18px;margin:0 0 4px}.sub{font-size:12.5px;color:#9da7b3;margin:0 0 12px;line-height:1.45}
.panel{margin:0 0 14px}.label{font-size:13px;font-weight:600;padding:5px 10px;border-radius:6px 6px 0 0;display:inline-block}
.g{background:#173a25;color:#8fe3a8}.r{background:#3d1f22;color:#ffb3ad}.a{background:#3a2f12;color:#f2cc60}
.crop{background-color:#fff;background-repeat:no-repeat;border:1px solid #30363d}
.gap{color:#6e7681;font-size:12px;text-align:center;line-height:12px;background:#161b22;width:${W}px;border-left:1px solid #30363d;border-right:1px solid #30363d}`;
const A = [70, 320], B = [1090, 1330];
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card">
<h1>Round 5 addendum: the real Managed panel on Linux while new work is refused</h1>
<p class="sub">Linux aarch64 rig with the durable local process on: managed-agent-server jar (embedded Runtime Broker), packaged Hosted Harness, MySQL 8.0.45, WebShell (vite) from each arm's own tree. A bound later Turn is running; then alice's can_create is revoked (or the Workspace set DRAINING) and the page is opened. Crops are unmodified regions of the raw screenshots in the evidence directory.</p>
${panel('current head 25eb9ae2 · create revoked · running: composer hidden, "Cancel turn" shown', 'g', 'c13-head2-revoke-1-before-en', [A, B])}
${panel('current head 25eb9ae2 · after the click: 202 → CANCELLED in 1.66 s, Environment: Ready, no error', 'g', 'c13-head2-revoke-2-after-en', [A])}
${panel('main 43a6e1e5 · create revoked · running: no Cancel control (the API answers 409; the Turn runs on and FAILS at +30.6 s)', 'r', 'c13-base-revoke-1-before-en', [A, B])}
${panel('eb3b9336 · DRAINING · zh: 「取消本轮」 shown; clicked → 202 → CANCELLED in 1.62 s', 'g', 'c13-head-draining-1-before-zh', [A, B])}
${panel('main 43a6e1e5 · DRAINING · zh: no cancel control', 'r', 'c13-base-draining-1-before-zh', [A, B])}
</div>`;
fs.writeFileSync('fig/r5-02-webshell.html', html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W + 48, height: 800 }, deviceScaleFactor: 2 });
await p.goto(`file://${path.resolve('fig/r5-02-webshell.html')}`);
await p.waitForTimeout(500);
await p.locator('#card').screenshot({ path: 'fig/r5-02-webshell.png' });
await b.close();
console.log('ok');
