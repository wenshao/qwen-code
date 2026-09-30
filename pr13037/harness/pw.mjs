// shared Playwright helpers
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13037/packages/web-shell/package.json');
export const { chromium, webkit } = require('@playwright/test');
export const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5137';
export const SHOTS = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/19f717cd-fa69-4495-b803-21c540ab1bd6/scratchpad/shots';
export const url = (session, extra = '') => `${ORIGIN}/e2e/fixtures/o3-rig.html?theme=light${session ? '&session=' + session : ''}${extra}`;
export async function open(browser, session, extra = '', viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`.slice(0, 300)));
  await page.goto(url(session, extra), { waitUntil: 'load' });
  return { context, page, logs };
}

export const SPLIT = 'Message execution is not available in this service yet.';
export async function transcript(page) {
  return ((await page.locator('body').innerText()).split(SPLIT)[1] ?? '').trim().replace(/\n+/g, ' | ');
}
// expand the "N tool call(s)" group if collapsed, then every Shell row
export async function expandShell(page) {
  await page.getByText(/tool calls?$/).first().waitFor({ timeout: 60000 });
  if (!(await page.getByText('Shell', { exact: true }).count())) {
    await page.getByText(/tool calls?$/).first().click();
    await page.waitForTimeout(400);
  }
  const rows = page.getByText('Shell', { exact: true });
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    if ((await page.locator('[data-managed-tool-result]').count()) > i) continue;
    await rows.nth(i).click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
}
export async function openPanel(page, index = 0) {
  await page.getByRole('button', { name: 'View output' }).nth(index).click();
  await page.locator('[role=dialog]').waitFor({ timeout: 15000 });
  await page.locator('[role=dialog] pre[data-managed-output-bytes], [role=dialog] p').first().waitFor({ timeout: 30000 });
}
export async function waitPage(page, timeout = 60000) {
  // wait until the content pane is not in "Reading output…" state
  const dialog = page.locator('[role=dialog]');
  await page.waitForFunction(() => {
    const d = document.querySelector('[role=dialog]');
    return d && !/Reading output|Loading/.test(d.textContent ?? '') && d.querySelector('pre[data-managed-output-bytes]');
  }, null, { timeout });
  return dialog;
}
export const rig = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__rig)));
