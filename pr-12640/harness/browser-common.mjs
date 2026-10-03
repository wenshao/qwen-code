import { createRequire } from 'node:module';
const require = createRequire('/root/verify/pr12640/head/package.json');
export const { chromium } = require('playwright');
export const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';

export async function openShell(browser, d, { scale = 2, width = 1440, height = 960 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: 'light' });
  const page = await context.newPage();
  const wire = [];
  const t0 = Date.now();
  page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/workspace/extensions') || u.pathname === '/capabilities') wire.push({ t: Date.now() - t0, method: req.method(), path: u.pathname, kind: 'req' }); });
  page.on('response', (res) => { const u = new URL(res.url()); if (u.pathname.startsWith('/workspace/extensions')) wire.push({ t: Date.now() - t0, path: u.pathname, status: res.status(), kind: 'res' }); });
  await page.goto(`${d.base}/?token=${d.token}`);
  await page.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 60_000 });
  return { context, page, wire };
}

export async function submitLocalCommand(page, text) {
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.locator('[data-web-shell-composer-submit]').click();
}

export async function openExtensions(page) {
  const t = Date.now();
  await submitLocalCommand(page, '/extensions');
  await page.getByRole('heading', { name: 'Manage Extensions' }).waitFor();
  await page.getByRole('button', { name: 'Rich Qwen Extension', exact: true }).waitFor({ timeout: 30_000 });
  return Date.now() - t;
}

export function card(page, title) { return page.getByRole('button', { name: title, exact: true }); }
export async function backToList(page) { await page.getByRole('button', { name: 'Manage Extensions', exact: true }).click(); await card(page, 'Rich Qwen Extension').waitFor(); }
export const tabList = (page) => page.getByRole('tablist');
