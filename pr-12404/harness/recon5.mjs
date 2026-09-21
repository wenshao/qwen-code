import { launch, UI_URL, OUT, sleep } from './ui.mjs';
const { browser, page, log } = await launch();
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('[console.error]', m.text().slice(0, 2500)); });
await page.goto(UI_URL); await sleep(4000);
await page.getByText('New task').first().click(); await sleep(1200);
const ed = page.locator('[contenteditable="true"]').first();
const pick = async (prov, item) => { await page.keyboard.type('@'); await sleep(700);
  await page.locator('[role="option"]', { hasText: prov }).first().click(); await sleep(1100);
  await page.locator('[role="option"]', { hasText: item }).first().click(); await sleep(900); };
const VARIANTS = [
  ['V1 cjk+file', async () => { await page.keyboard.type('V1 '); await page.keyboard.insertText('看一下 '); await pick('Files', 'README.md'); }],
  ['V2 emoji+file', async () => { await page.keyboard.type('V2 '); await page.keyboard.insertText('🚀 '); await pick('Files', 'README.md'); }],
  ['V3 file+cjk+ext', async () => { await page.keyboard.type('V3 '); await pick('Files', 'README.md'); await page.keyboard.insertText('和 '); await pick('Extensions', 'browser-kit'); }],
  ['V4 file+ascii+ext', async () => { await page.keyboard.type('V4 '); await pick('Files', 'README.md'); await page.keyboard.type('and '); await pick('Extensions', 'browser-kit'); }],
];
let n = 0;
for (const [label, fn] of VARIANTS) {
  await ed.click(); await fn();
  const reqP = page.waitForRequest((r) => r.method() === 'POST' && /\/prompt$/.test(new URL(r.url()).pathname), { timeout: 8000 });
  await page.keyboard.press('Enter');
  const req = await reqP.catch(() => null);
  if (!req) await page.screenshot({ path: `${OUT}/recon5-${label.split(' ')[0]}.png` }); console.log(label, 'submitted:', !!req, req ? JSON.stringify(req.postDataJSON().prompt[0].text) : '');
  if (!req) { await page.screenshot({ path: `${OUT}/recon5-${label.split(' ')[0]}.png` }); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await sleep(500); continue; }
  n++;
  await page.waitForFunction((k) => document.body.innerText.split('Done. (mock reply)').length - 1 >= k, n, { timeout: 30000 });
  await sleep(2000);
}
console.log(log.filter((l) => !/live-state|Bad Request/.test(l)).join('\n'));
await browser.close();
