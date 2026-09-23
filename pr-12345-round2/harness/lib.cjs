const { chromium } = require('playwright');
const fs = require('fs');
const H = '/root/verify/pr12345-r2-harness';
const BASE = 'http://localhost:5345';
function fakeLog() { try { return fs.readFileSync(H + '/fake-openai.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(e => !e.url.includes('/models')); } catch { return []; } }
async function open(browser, query, path = '/e2e/realdaemon-harness.html', waitComposer = true) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', r => {
    const u = r.url().replace(BASE, '');
    if (r.method() !== 'GET' && !u.startsWith('/@') && !u.includes('/node_modules/')) wire.push({ t: Date.now(), m: r.method(), u, body: (r.postData() || '').slice(0, 300) });
  });
  page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
  await page.route('**/agentic-code**', async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const response = await route.fetch({ url: `${BASE}/e2e/realdaemon-harness.html` });
    await route.fulfill({ response });
  });
  await page.goto(BASE + path + '?' + query);
  if (waitComposer) await page.locator('[data-web-shell-composer-editor] .cm-content').first().waitFor({ timeout: 30000 });
  else await page.getByRole('navigation', { name: 'Settings' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page, wire };
}
async function type(page, text) {
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}
async function submit(page, text) {
  await type(page, text);
  await page.locator('[data-web-shell-composer-submit]').first().click();
}
async function toastText(page) {
  const t = await page.locator('[data-sonner-toast], [role="status"], [role="alert"]').allInnerTexts().catch(() => []);
  return t.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function promptPosts(wire, since = 0) { return wire.filter(w => w.t >= since && w.m === 'POST' && /\/prompt(\?|$)/.test(w.u)); }
function sessionPosts(wire, since = 0) { return wire.filter(w => w.t >= since && w.m === 'POST' && /\/session(\?|$)/.test(w.u)); }
module.exports = { chromium, fakeLog, open, type, submit, toastText, promptPosts, sessionPosts, H, BASE, fs };
