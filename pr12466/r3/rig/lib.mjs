import { chromium } from '/Users/wenshao/git/qwen-12466/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

export const SHOTS = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a83678d6-9a49-4e5e-958d-4d6e8041cf10/scratchpad/shots';
fs.mkdirSync(SHOTS, { recursive: true });

export async function openShell(port, { profile, theme = 'dark', width = 1440, height = 900 } = {}) {
  const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const opts = {
    headless: true,
    executablePath: fs.existsSync(exe) ? exe : undefined,
    args: ['--proxy-server=direct://', '--use-mock-keychain', '--password-store=basic'],
    viewport: { width, height },
    serviceWorkers: 'block',
  };
  const ctx = profile
    ? await chromium.launchPersistentContext(profile, opts)
    : await (await chromium.launch(opts)).newContext(opts);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const requests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/tool-calls') || u.includes('/turn-index') || u.includes('/transcript'))
      requests.push({ t: Date.now(), method: r.method(), url: u.replace(/^https?:\/\/[^/]+/, '') });
  });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/tool-calls') || u.includes('/turn-index'))
      requests.push({ t: Date.now(), status: r.status(), url: u.replace(/^https?:\/\/[^/]+/, '') });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?token=tok12466&language=en&theme=${theme}`);
  await page.waitForSelector('.cm-content', { timeout: 60000 });
  return { ctx, page, requests, errors };
}

export async function send(page, text) {
  for (let i = 0; i < 3; i++) {
    await page.click('.cm-content');
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text);
    const got = await page.$eval('.cm-content', (e) => e.innerText.trim());
    if (got === text) break;
  }
  await page.keyboard.press('Enter');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
