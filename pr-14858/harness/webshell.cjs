// Real Web Shell against a real daemon: type a scenario, wait for the loop
// stop, screenshot it, reload, screenshot again, switch language, screenshot.
// usage: node webshell.cjs <baseUrl> <token> <scen> <outDir> <firstLang> [sessionId]
//   with sessionId: open that existing session (cold-load path) instead of typing.
const { chromium } = require('/root/verify/pr14858/wt-head/node_modules/playwright');
const fs = require('node:fs');

const [base, token, scen, outDir, firstLang, existingSession] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const LOOP_RE = /this turn was stopped|so it was stopped|停止了本轮操作/;

async function loopText(page) {
  const loc = page.getByText(LOOP_RE).last();
  await loc.waitFor({ timeout: 600000 });
  await page.waitForTimeout(1200);
  return loc;
}

async function shoot(page, loc, name) {
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await loc.boundingBox();
  const vp = page.viewportSize();
  // a band around the stop message: the message plus the turn above it
  const y = Math.max(0, box.y - 150);
  const h = Math.min(vp.height - y, box.height + 220);
  await page.screenshot({ path: `${outDir}/${name}.png`, clip: { x: 0, y, width: vp.width, height: h } });
  await page.screenshot({ path: `${outDir}/${name}-full.png` });
  const text = (await loc.innerText()).trim();
  fs.writeFileSync(`${outDir}/${name}.txt`, text + '\n');
  return text;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const result = {};
  let lang = firstLang;
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    locale: lang === 'zh-CN' ? 'zh-CN' : 'en-US',
  });
  await ctx.addInitScript(() => {
    const want = window.name.startsWith('lang:') ? window.name.slice(5) : null;
    if (want) localStorage.setItem('qwen-code-web-shell-language', want);
  });
  const page = await ctx.newPage();
  const setLang = async (l) => {
    await page.evaluate((v) => {
      window.name = 'lang:' + v;
      localStorage.setItem('qwen-code-web-shell-language', v);
    }, l);
  };
  await page.goto(`${base}/?token=${token}`);
  await setLang(lang);
  if (existingSession) {
    await page.goto(`${base}/session/${existingSession}?token=${token}`);
  } else {
    await page.reload();
    const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
    await editor.waitFor({ timeout: 60000 });
    await editor.click();
    await page.keyboard.type(`SCEN=${scen} go`);
    await page.locator('[data-web-shell-composer-submit]').click();
  }
  let loc = await loopText(page);
  result.live = { lang, url: page.url(), text: await shoot(page, loc, existingSession ? `open-${lang}` : `live-${lang}`) };
  if (!existingSession) {
    await page.reload();
    loc = await loopText(page);
    result.reload = { lang, url: page.url(), text: await shoot(page, loc, `reload-${lang}`) };
  }
  lang = lang === 'en' ? 'zh-CN' : 'en';
  await setLang(lang);
  await page.reload();
  loc = await loopText(page);
  result.otherLang = { lang, url: page.url(), text: await shoot(page, loc, existingSession ? `open-${lang}` : `reload-${lang}`) };
  fs.writeFileSync(`${outDir}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
