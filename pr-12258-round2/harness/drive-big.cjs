// Large App HTML: default 1 MiB limit vs appResourceMaxBytes=2 MiB, then cold-daemon replay.
// usage: node drive-big.cjs <phase: live|replay> <daemonPort> <outDir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const [PHASE, DP, OUT] = process.argv.slice(2); fs.mkdirSync(OUT, { recursive: true });
const RF = path.join(OUT, `result-${PHASE}.json`); const R = { steps: [] };
const step = (name, d) => { R.steps.push({ name, ...d }); console.log('STEP', name, JSON.stringify(d).slice(0, 500)); fs.writeFileSync(RF, JSON.stringify(R, null, 1)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function appInfo(card) {
  const f = await (await card.locator('iframe').elementHandle().catch(() => null))?.contentFrame();
  if (!f) return { iframe: false, text: (await card.innerText()).slice(0, 600) };
  let inner; for (let i = 0; i < 80 && !inner; i++) { inner = f.childFrames()[0]; if (!inner) await sleep(250); }
  if (!inner) return { iframe: true, inner: false };
  await inner.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => {});
  return { iframe: true, origin: await inner.evaluate(() => self.origin), htmlBytes: await inner.evaluate(() => new Blob([document.documentElement.outerHTML]).size), ready: await inner.evaluate(() => !!window.__ready) };
}
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  const composer = page.locator('[data-web-shell-composer-editor] .cm-content');
  const send = async (t) => { await composer.click(); await page.keyboard.type(t); await page.locator('[data-web-shell-composer-submit]').click(); };
  const approve = async () => { const p = page.locator('[data-web-shell-permission-panel]').first(); await p.waitFor({ timeout: 30000 }); await p.locator('[data-option-id="proceed_once"]').click(); await p.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {}); };
  if (PHASE === 'live') {
    await page.goto(`http://127.0.0.1:${DP}/?token=tok-head`); await composer.waitFor({ timeout: 30000 });
    await send('hello'); await page.getByText('[done:plain]').first().waitFor({ timeout: 60000 });
    await send('show big dashboard'); await approve(); await page.getByText('[done:dashboard]').first().waitFor({ timeout: 90000 });
    await sleep(1500);
    const tool1 = page.locator('text=mcp__big__show_dashboard').first();
    await tool1.click().catch(() => {}); await sleep(800);
    const bodyText = await page.locator('main').innerText().catch(() => page.innerText('body'));
    step('big-default-limit', { cards: await page.locator('[data-testid="mcp-app"]').count(), warningShown: /appResourceMaxBytes|host limit/i.test(bodyText), snippet: (bodyText.match(/.{0,160}(appResourceMaxBytes|host limit).{0,160}/s) || [''])[0] });
    await page.screenshot({ path: path.join(OUT, 'big-default.png') });
    await send('show bigok dashboard'); await approve(); await page.getByText('[done:dashboard]').nth(1).waitFor({ timeout: 90000 });
    const card = page.locator('[data-testid="mcp-app"]').last(); await card.waitFor({ timeout: 60000 });
    step('bigok-rendered', { url: page.url(), ...(await appInfo(card)) });
    await card.screenshot({ path: path.join(OUT, 'bigok-live.png') });
    fs.writeFileSync(path.join(OUT, 'session-url.txt'), page.url());
  } else {
    const url = fs.readFileSync(path.join(OUT, 'session-url.txt'), 'utf8').trim();
    await page.goto(url + (url.includes('?') ? '&' : '?') + 'token=tok-head'); await composer.waitFor({ timeout: 30000 });
    const cards = page.locator('[data-testid="mcp-app"]'); await cards.first().waitFor({ timeout: 90000 });
    await sleep(2000);
    const n = await cards.count(); const infos = []; for (let i = 0; i < n; i++) infos.push(await appInfo(cards.nth(i)));
    const bodyText = await page.innerText('body');
    step('cold-replay', { url, cards: n, infos, bigWarningStillShown: /appResourceMaxBytes|host limit/i.test(bodyText) });
    await cards.last().screenshot({ path: path.join(OUT, 'bigok-replay.png') });
    const row = page.getByText('mcp__big__show_dashboard').first();
    await row.scrollIntoViewIfNeeded(); await row.click(); await sleep(1000);
    let t = await page.innerText('body');
    if (!/host limit/.test(t)) { await row.locator('xpath=..').locator('button').last().click().catch(() => {}); await sleep(1000); t = await page.innerText('body'); }
    step('big-card-expanded', { warningShown: /host limit/.test(t), snippet: (t.match(/Warning: MCP App[^\n]*/) || [''])[0] });
    await row.locator('xpath=../..').screenshot({ path: path.join(OUT, 'big-default-expanded.png') }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, 'replay-page.png') });
  }
  await browser.close();
})().catch(e => { step('FATAL', { error: String(e.stack || e).slice(0, 1200) }); process.exit(1); });
