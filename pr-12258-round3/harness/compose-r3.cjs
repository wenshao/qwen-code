const { chromium } = require('playwright'); const fs = require('fs');
const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
async function compose(out, title, sub, panels, cols, width) {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 2000, height: 800 }, deviceScaleFactor: 1 })).newPage();
  const html = `<html><body style="margin:0;background:#0d1117;font-family:system-ui,sans-serif;color:#e6edf3">
  <div class="wrap" style="padding:18px 20px;display:inline-block;width:${width}px;box-sizing:border-box">
  <div style="font-size:22px;font-weight:700;margin-bottom:4px">${esc(title)}</div>
  ${sub ? `<div style="font-size:14px;color:#9da7b3;margin-bottom:12px">${esc(sub)}</div>` : ''}
  <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px;align-items:start">
  ${panels.map(p => `<div><div style="font-size:14.5px;margin:0 0 6px;color:${p.color || '#e6edf3'};font-weight:600;min-height:40px">${esc(p.cap)}</div><img src="${img(p.src)}" style="width:100%;border:2px solid ${p.color || '#30363d'};border-radius:8px"></div>`).join('')}
  </div></div></body></html>`;
  await page.setContent(html); await page.waitForTimeout(300);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 10, height: Math.ceil(box.height) + 10 });
  await page.locator('.wrap').screenshot({ path: out }); await b.close();
  console.log('wrote', out);
}
const O = '/root/verify/pr12258-r2'; const D = O + '/out-r3-head2'; const R = O + '/report3';
fs.mkdirSync(R, { recursive: true });
(async () => {
  await compose(`${R}/fig1-b1-three-arm.png`,
    'B1 re-test — top-level tab 4s after the App strips its own sandbox attribute and attempts top-navigation + popup',
    'Real bundled WebShell → real daemon → real ACP child → real stdio MCP server running the official @modelcontextprotocol/ext-apps App SDK. Same attack in all three arms.',
    [
      { cap: 'FIXED · new head adc3c2280 · WebKit 26.5 — attr stripped, but header CSP sandbox holds: tab intact, App still contained, no popup, no attacker hit', src: `${D}/csp-escape-webkit.png`, color: '#3fb950' },
      { cap: 'REGRESSION · prior head 8a2b0a6d3 · WebKit 26.5 — no CSP sandbox header: top tab hijacked to the attacker page + popup opened', src: `${D}/csp-escape-r2neg-webkit.png`, color: '#f85149' },
      { cap: 'FIXED · new head adc3c2280 · Chromium 149 — attr stripped, tab intact (Chromium already blocked the end effect at the prior head too)', src: `${D}/csp-escape-chromium.png`, color: '#3fb950' },
    ], 3, 2400);
  await compose(`${R}/fig2-app-tools-and-approval.png`,
    'App → server tool calls stay gated and scoped on the new head',
    'The App-initiated get_embed_token call raises the WebShell approval dialog; on approval the raw token/JWT returns only to the App — it appears in none of the 25 model requests and no session transcript.',
    [
      { cap: 'App-initiated get_embed_token → WebShell approval dialog (tool hidden from the model)', src: `${D}/perm-app-token.png` },
      { cap: 'After approval: full App→server matrix — model-only & unknown tools rejected with no prompt/exec, deny path canceled, isError surfaced', src: `${D}/app-card-after-matrix.png` },
    ], 2, 2000);
  await compose(`${R}/fig3-sibling-isolation.png`,
    'Per-render isolated origins + sibling isolation (new head)',
    'Two Apps in one page each get a distinct <uuid>.localhost origin; cross-App DOM access throws SecurityError and document.domain assignment is now forbidden (header CSP sandbox active).',
    [{ cap: 'Two dashboards rendered together — distinct origins, siblingAppDocs → SecurityError, documentDomainSet → "Assignment is forbidden for sandboxed iframe"', src: `${D}/page-two-apps.png` }], 1, 1500);
  console.log('done');
})();
