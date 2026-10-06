// VERIFICATION RIG ONLY (PR #13163 R6): lays the raw WebShell screenshots (raw/, unmodified) out as one figure.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/root/git/qwen-code-x9/package.json');
const { chromium } = require('playwright');
const RAW = path.resolve('raw');
const W = 900, SRC = 2360, X0 = 507, CW = SRC - X0, S = W / CW;
const crop = (file, y0, y1, x0 = X0) => `<div class="crop" style="width:${W}px;height:${Math.round((y1 - y0) * S)}px;background-image:url('file://${RAW}/${file}.png');background-size:${Math.round(SRC * S)}px auto;background-position:-${Math.round(x0 * S)}px -${Math.round(y0 * S)}px"></div>`;
const panel = (label, cls, file, parts) => `<div class="panel"><div class="label ${cls}">${label}</div>${parts.map(([a, b, x]) => crop(file, a, b, x)).join('<div class="gap">⋯</div>')}</div>`;
const css = `body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI","Noto Sans CJK SC",sans-serif;color:#e6edf3}
#card{width:${W + 48}px;padding:20px 24px}
h1{font-size:18px;margin:0 0 4px}.sub{font-size:12.5px;color:#9da7b3;margin:0 0 12px;line-height:1.45}
.panel{margin:0 0 14px}.label{font-size:13px;font-weight:600;padding:5px 10px;border-radius:6px 6px 0 0;display:inline-block}
.g{background:#173a25;color:#8fe3a8}
.crop{background-color:#fff;background-repeat:no-repeat;border:1px solid #30363d}
.gap{color:#6e7681;font-size:12px;text-align:center;line-height:12px;background:#161b22;width:${W}px;border-left:1px solid #30363d;border-right:1px solid #30363d}`;
const A = [70, 320], B = [1090, 1330];
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card">
<h1>Round 6: the real Managed panel at 13df2a65 while new work is refused</h1>
<p class="sub">Same Linux rig as the figure above; WebShell (vite) from the 13df2a65 tree. A bound later Turn is running; then alice's can_create is revoked (or the Workspace set DRAINING) and the page is opened. Crops are unmodified regions of the raw screenshots in the evidence directory.</p>
${panel('13df2a65 · create revoked · running: composer hidden, "Cancel turn" shown', 'g', 'c13-head3-revoke-1-before-en', [A, B])}
${panel('13df2a65 · after the click: 202 → CANCELLED in 1.66 s, Environment: Ready', 'g', 'c13-head3-revoke-2-after-en', [A])}
${panel('13df2a65 · DRAINING · zh: 「取消本轮」 shown', 'g', 'c13-head3-draining-1-before-zh', [A, B])}
${panel('13df2a65 · DRAINING · zh · after the click: 已取消 in 1.67 s', 'g', 'c13-head3-draining-2-after-zh', [A])}
</div>`;
fs.writeFileSync('fig/r6-linux-02-webshell.html', html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W + 48, height: 800 }, deviceScaleFactor: 2 });
await p.goto(`file://${path.resolve('fig/r6-linux-02-webshell.html')}`);
await p.waitForTimeout(500);
await p.locator('#card').screenshot({ path: 'fig/r6-linux-02-webshell.png' });
await b.close();
console.log('ok');
