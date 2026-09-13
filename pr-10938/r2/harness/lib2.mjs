// Round-2 helpers: three arms against ONE real daemon built from head 5c4f1de.
//   head   :4938  daemon-served PR head bundle
//   base   :4939  proxy, merge-base bc7a186 bundle (the 7 changed sources at main)
//   revert :4940  proxy, head bundle with fix commit 4860e0a7e6 reverse-applied
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/var/tmp/pr10938-wt/node_modules/');
export const { chromium } = require('playwright');

export const H = '/root/git/pr10938-harness';
export const R2 = path.join(H, 'r2');
export const FIGS = path.join(R2, 'figs');
fs.mkdirSync(FIGS, { recursive: true });
// lanefix :4941 is NOT the PR — a candidate fix for the lane-edge crossing, served for comparison only.
export const ARMS = { head: 'http://127.0.0.1:4938', base: 'http://127.0.0.1:4939', revert: 'http://127.0.0.1:4940', lanefix: 'http://127.0.0.1:4941', r8fix: 'http://127.0.0.1:4942' };
export const THEME_KEY = 'qwen-code-web-shell-theme';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sid = (label) => fs.readFileSync(`${H}/out/session-${label}.txt`, 'utf8').trim();

export async function launch() {
  return chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
}

export async function openPage(browser, { theme = 'dark', width = 1440, height = 900, dsf = 1, init } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  const page = await context.newPage();
  await page.addInitScript(
    ([k, v, extra]) => {
      try {
        localStorage.setItem(k, v);
        for (const [ek, ev] of Object.entries(extra || {})) localStorage.setItem(ek, ev);
      } catch {}
    },
    [THEME_KEY, theme, init || {}],
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
  fs.writeFileSync(path.join(R2, 'out', name), JSON.stringify(data, null, 2));
}

export const noise = (p) => p.includes('Conversations') || p.includes('Failed to load resource');
