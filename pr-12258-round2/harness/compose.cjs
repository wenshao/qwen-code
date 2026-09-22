const { chromium } = require('playwright'); const fs = require('fs');
const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
async function compose(out, title, panels, cols) {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 2000, height: 800 }, deviceScaleFactor: 1 })).newPage();
  const html = `<html><body style="margin:0;background:#0d1117;font-family:system-ui,sans-serif;color:#e6edf3">
  <div class="wrap" style="padding:18px 20px;display:inline-block;width:${cols === 1 ? 1400 : 2000}px;box-sizing:border-box">
  <div style="font-size:22px;font-weight:700;margin-bottom:12px">${esc(title)}</div>
  <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px;align-items:start">
  ${panels.map(p => `<div><div style="font-size:15px;margin:0 0 6px;color:${p.color || '#e6edf3'};font-weight:600">${esc(p.cap)}</div><img src="${img(p.src)}" style="width:100%;border:1px solid #30363d;border-radius:8px"></div>`).join('')}
  </div></div></body></html>`;
  await page.setContent(html); await page.waitForTimeout(300);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 10, height: Math.ceil(box.height) + 10 });
  await page.locator('.wrap').screenshot({ path: out }); await b.close();
}
const O = '/root/verify/pr12258-r2';
if (!process.env.ESCAPE) (async () => {
  await compose(`${O}/report/01-origin-and-app-tools-ab.png`, 'Same fixture App, same nested vendor frame — base e1213d57 vs PR head 8a2b0a6 (real Chromium, real daemon, real stdio MCP server)', [
    { cap: 'BASE: App origin null · nested vendor frame origin null → vendor rejects Origin: null · tools/call → -32601', src: `${O}/out-base/app-card-token.png`, color: '#ff7b72' },
    { cap: 'HEAD: App on its own uuid.localhost origin · vendor frame keeps http://127.0.0.1:18701 → 200 · App tools answered', src: `${O}/out-head/app-card-after-matrix.png`, color: '#7ee787' }], 2);
  await compose(`${O}/report/02-app-initiated-call-approval.png`, 'HEAD: an App-initiated call to an App-only tool goes through the session approval dialog, and the raw result returns only to the App', [
    { cap: 'WebShell approval dialog raised by the App\'s get_embed_token call (tool is hidden from the model)', src: `${O}/out-head/perm-app-token.png` },
    { cap: 'After "Yes, allow once": raw content + structuredContent delivered to the App (SECRET never reaches model requests or the transcript)', src: `${O}/out-head/app-card-token.png` }], 1);
  await compose(`${O}/report/05-webkit-app-isolated-origin.png`, 'HEAD in WebKit 26.5 (Playwright, Linux): *.localhost isolated origin loads, serverTools advertised, vendor frame keeps its origin', [
    { cap: 'Replayed App in WebKit — daemon API/WS probes from the App origin rejected (403 preflight / handshake refused)', src: `${O}/out-head/webkit-replay.png` }], 1);
  fs.copyFileSync(`${O}/out-head/page-two-apps.png`, `${O}/report/03-two-apps-distinct-origins.png`);
  fs.copyFileSync(`${O}/out-big/big-default-expanded.png`, `${O}/report/04-resource-limits-after-cold-restart.png`);
  console.log('ok');
})();
// escape figure (appended; run with ESCAPE=1)
if (process.env.ESCAPE) (async () => {
  await compose(`${O}/report/06-webkit-top-navigation-escape.png`, 'Sandbox boundary check — state of the top-level Qwen tab 4 s after a sandbox-boundary probe run by the App itself', [
    { cap: 'HEAD + WebKit 26.5: Qwen tab navigated to the attacker URL, popup opened', src: `${O}/out-rerun/escape-app-own-webkit.png`, color: '#ff7b72' },
    { cap: 'BASE + WebKit 26.5: SecurityError (App origin is opaque) — tab intact', src: `${O}/out-base/escape-app-own-webkit.png`, color: '#7ee787' },
    { cap: 'HEAD + Chromium 149: attribute stripped, outer sandbox still blocks — tab intact', src: `${O}/out-rerun/escape-app-own-chromium.png`, color: '#7ee787' }], 3);
  console.log('escape ok');
})();
