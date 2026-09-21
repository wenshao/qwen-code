const fs = require('fs');
const { chromium } = require('playwright-core');
const [out, ...panes] = process.argv.slice(2); // pane = label::path
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cells = panes.map((p) => { const [label, file] = p.split('::'); return `<div class="cell"><div class="lab">${esc(label)}</div><img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"></div>`; }).join('');
const html = `<!doctype html><html><body style="margin:0;background:#0d1117"><div id="g" style="display:grid;grid-template-columns:repeat(${panes.length},1fr);gap:18px;padding:18px;align-items:start;width:max-content">${cells}</div>
<style>.cell{width:980px}.cell img{width:980px;display:block}.lab{color:#f0f6fc;font:700 22px -apple-system,Segoe UI,sans-serif;margin:0 0 10px 4px}</style></body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
  const p = await b.newPage({ viewport: { width: 2200, height: 1200 }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.waitForTimeout(300);
  const box = await p.locator('#g').boundingBox();
  await p.setViewportSize({ width: Math.ceil(box.width + 10), height: Math.ceil(box.height + 10) });
  await p.locator('#g').screenshot({ path: out });
  await b.close(); console.log('wrote', out, box);
})();
