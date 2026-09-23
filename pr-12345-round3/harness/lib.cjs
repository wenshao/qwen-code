const { chromium } = require('playwright');
const fs = require('fs');
const H = '/root/verify/pr12345-r3-harness';
const DAEMON = 'http://127.0.0.1:14346', TOKEN = 't12345';
function fakeLog() { try { return fs.readFileSync(H + '/fake-openai.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(e => !e.url.includes('/models')); } catch { return []; } }
async function open(browser, base, query) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', r => {
    const u = r.url().replace(base, '');
    if (r.method() !== 'GET' && !u.startsWith('/@') && !u.includes('/node_modules/')) wire.push({ t: Date.now(), m: r.method(), u, body: (r.postData() || '').slice(0, 300) });
  });
  page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
  await page.goto(base + '/e2e/realdaemon-harness.html?' + query);
  await page.locator('[data-web-shell-composer-editor] .cm-content').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page, wire };
}
async function typeIn(page, editor, text) {
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}
async function toastText(page) {
  const t = await page.locator('[data-sonner-toast], [role="status"], [role="alert"]').allInnerTexts().catch(() => []);
  return t.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function promptPosts(wire, since = 0) { return wire.filter(w => w.t >= since && w.m === 'POST' && /\/prompt(\?|$)/.test(w.u)); }
async function api(method, path, body, clientId) {
  const r = await fetch(DAEMON + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(clientId ? { 'x-qwen-client-id': clientId } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { status: r.status, body: j };
}
module.exports = { chromium, fakeLog, open, typeIn, toastText, promptPosts, api, H, DAEMON, TOKEN, fs };
