const { chromium } = require('playwright');
const fs = require('node:fs');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const uri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
async function figure(browser, out, title, panes) {
  const page = await browser.newPage({ viewport: { width: 1640, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0;background:#0d1117;font-family:DejaVu Sans,Arial,sans-serif;color:#e6edf3">
  <div class="wrap" style="padding:18px 20px 20px;width:1600px">
    <div style="font-size:19px;font-weight:600;margin-bottom:14px">${esc(title)}</div>
    <div style="display:flex;gap:16px">${panes.map((p) => `<div style="flex:1;min-width:0">
      <div style="font-size:15px;font-weight:600;color:${p.color};margin-bottom:4px">${esc(p.label)}</div>
      <div style="font-size:13px;color:#9da7b3;margin-bottom:8px;min-height:34px;line-height:17px">${esc(p.note)}</div>
      <img src="${uri(p.img)}" style="width:100%;display:block;border:1px solid #30363d;border-radius:6px"/></div>`).join('')}</div>
  </div></body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
  await page.locator('.wrap').screenshot({ path: out });
  await page.close();
}
(async () => {
  const browser = await chromium.launch();
  await figure(browser, 'fig1-esc-esc-before-after.png', 'Send a mistaken prompt, then press Esc twice before the model has answered', [
    { label: 'Before (main)', color: '#f85149', note: 'The prompt stays in the transcript, the composer is empty, and an "interrupted" banner offers to continue it.', img: 'out-base/S1-c-after.png' },
    { label: 'After (this PR)', color: '#3fb950', note: 'The prompt is back in the composer, ready to fix, and the turn is gone from the session.', img: 'out-head/S1-c-after.png' },
  ]);
  await figure(browser, 'fig2-resend-before-after.png', 'Then send the corrected prompt', [
    { label: 'Before (main)', color: '#f85149', note: 'Both prompts stay in history and reach the model merged into one user message. The scripted model stalls again because the mistaken text is still in it.', img: 'out-base/S1-d-resent.png' },
    { label: 'After (this PR)', color: '#3fb950', note: 'Only the corrected prompt is in history and in the request the model receives.', img: 'out-head/S1-d-resent.png' },
  ]);
  await figure(browser, 'fig3-attachment-before-after.png', 'Same, for a prompt with a pasted image', [
    { label: 'Before (main)', color: '#f85149', note: 'Prompt and image stay in the transcript; the composer is empty.', img: 'out-base/S12-after.png' },
    { label: 'After (this PR)', color: '#3fb950', note: 'Text and image attachment are both back in the composer.', img: 'out-head/S12-after.png' },
  ]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
