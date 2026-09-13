import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/var/tmp/pr10938-wt/node_modules/');
export const { chromium } = require('playwright');

export const H = '/root/git/pr10938-harness';
export const FIGS = path.join(H, 'figs');
fs.mkdirSync(FIGS, { recursive: true });
export const ARMS = { head: 'http://127.0.0.1:4938', base: 'http://127.0.0.1:4939' };
export const THEME_KEY = 'qwen-code-web-shell-theme';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  return chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
}

/** A page primed to a theme, collecting console errors / page errors / 4xx-5xx. */
export async function openPage(browser, { theme = 'dark', width = 1440, height = 900, dsf = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  const page = await context.newPage();
  await page.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
    [THEME_KEY, theme],
  );
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
  return { context, page, problems };
}

export async function gotoSession(page, arm, sessionId, { theme = 'dark', view } = {}) {
  const q = new URLSearchParams({ theme, ...(view ? { view } : {}) });
  await page.goto(`${ARMS[arm]}/session/${encodeURIComponent(sessionId)}?${q}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-web-shell-root]').waitFor({ timeout: 30000 });
}

export function writeJson(name, data) {
  fs.writeFileSync(path.join(H, 'out', name), JSON.stringify(data, null, 2));
}
