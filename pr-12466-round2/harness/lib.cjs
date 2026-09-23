// Real Web Shell (served by the real daemon) in Chromium. No page.route.
const pw = require('/root/verify/pr12466-head/node_modules/@playwright/test');
const TOKEN = 'tok-12466';
async function launch(opts = {}) {
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1560, height: 940 },
    deviceScaleFactor: opts.dpr ?? 2,
    colorScheme: opts.colorScheme ?? 'light',
    locale: opts.locale ?? 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await context.newPage();
  const wire = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (/\/(tool-calls|turn-index|transcript)$/.test(u.pathname)) wire.push({ t: Date.now(), method: req.method(), path: u.pathname.replace(/^.*\/session\/[^/]+/, ''), search: u.search });
  });
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (/\/tool-calls$/.test(u.pathname)) {
      const w = [...wire].reverse().find((x) => x.path === '/tool-calls' && x.search === u.search && x.status === undefined);
      if (w) { w.status = res.status(); try { const b = await res.json(); w.events = b.events?.length; w.code = b.code; } catch {} }
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { browser, context, page, wire, errors };
}
async function openSession(page, base, sessionId) {
  await page.goto(`${base}/session/${encodeURIComponent(sessionId)}?token=${TOKEN}`);
  await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(2500);
}
module.exports = { launch, openSession, TOKEN, pw };
