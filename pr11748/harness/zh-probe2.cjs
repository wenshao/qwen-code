// zh-CN localization of the protocol-mismatch notice, end to end.
const { chromium } = require('/root/git/pr11748-harness/head/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const URL_ = process.env.URL, OUT = process.env.OUT;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const I18N = fs.readFileSync('/root/git/pr11748-harness/head/packages/web-shell/client/i18n.tsx', 'utf8');
const anyOf = (key) => new RegExp([...I18N.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'([^']*)'`, 'g'))].map((m) => m[1]).join('|'));
const zh = (s) => (s.match(/[一-鿿]/g) ?? []).length;
(async () => {
  const res = { url: URL_ };
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })).newPage();
  const sent = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/terminal')) return;
    ws.on('framesent', (f) => typeof f.payload === 'string' && sent.push(f.payload.replace(/\x00/g, '\\0')));
  });
  try {
    await page.goto(`${URL_}/`);
    const editor = page.locator('[data-web-shell-composer-editor] .cm-content').first();
    await editor.click({ timeout: 45000 });
    await sleep(2000);
    res.settingEntry = await page.evaluate(async () => {
      const j = await (await fetch('/workspace/settings')).json();
      let hit = null;
      const walk = (o) => {
        if (hit || !o || typeof o !== 'object') return;
        if (o.key === 'general.language') { hit = { key: o.key, values: o.values, value: o.value, effective: o.effective }; return; }
        Object.values(o).forEach(walk);
      };
      walk(j);
      return hit;
    });
    res.zhCharsOnLoad = zh(await page.evaluate(() => document.body.innerText));
    if (res.zhCharsOnLoad === 0) {
      await editor.click();
      await page.keyboard.type('/language ui zh-CN', { delay: 5 });
      await sleep(400);
      await page.keyboard.press('Enter');
      await sleep(2500);
      res.usedLanguageCommand = true;
      res.zhCharsAfterCommand = zh(await page.evaluate(() => document.body.innerText));
    }
    await editor.click();
    await page.keyboard.type('hello');
    await page.locator('[data-web-shell-composer-submit]').first().click();
    await sleep(1500);
    await page.getByRole('button', { name: anyOf('chatHeader.toggleRightPanel') }).first().click({ timeout: 30000 });
    res.toggleLabel = await page.getByRole('button', { name: anyOf('chatHeader.toggleRightPanel') }).first().getAttribute('aria-label');
    await page.getByRole('button', { name: anyOf('terminal.open') }).first().click({ timeout: 30000 });
    await page.locator('[data-web-terminal] .xterm').first().waitFor({ timeout: 30000 });
    await sleep(5000);
    res.terminalRows = await page.evaluate(() => [...(document.querySelector('[data-web-terminal] .xterm-rows')?.children ?? [])].map((r) => r.textContent).filter((s) => s.trim()).slice(0, 4));
    res.framesSent = sent;
    await page.screenshot({ path: path.join(OUT, 'page.png') });
    await page.locator('[data-web-terminal]').first().screenshot({ path: path.join(OUT, 'terminal.png') });
  } catch (e) {
    res.error = String(e).slice(0, 600);
    await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, 'zh.json'), JSON.stringify(res, null, 2));
  console.log('ZH2_DONE');
  await browser.close();
})();
