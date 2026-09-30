// VERIFICATION RIG ONLY (PR #13107): Playwright helpers that drive the real Managed panel.
// The page is the rig host fixture (client/e2e/fixtures/rig-13107.html) served by `vite` from the
// PR-head worktree (arm "head") or the base worktree (arm "base"); both proxy the WebShell adapter to the
// same Java server.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { RIG, DB, sleep } from './lib.mjs';

const require = createRequire(`${RIG}/wt3/package.json`);
const { chromium } = require('playwright');

const env = Object.fromEntries(
  fs
    .readFileSync(`${RIG}/rig.env`, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
export const PORTS = { head: env.VITE_HEAD_PORT, base: env.VITE_BASE_PORT };
export const FIG = `${RIG}/fig/raw`;
fs.mkdirSync(FIG, { recursive: true });

export async function launch() {
  return chromium.launch({ headless: true });
}

// Opens the host page. Returns { page, net, context } where net is the list of WebShell adapter calls the page made.
export async function open(browser, { arm = 'head', actor = 'alice', lang = 'en', session, theme = 'light', width = 1180, height = 860, skewMs = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  // skewMs shifts the browser's Date.now() to model a client clock that is ahead of (or behind) the service's.
  if (skewMs) await context.addInitScript(`(() => { const real = Date.now.bind(Date); Date.now = () => real() + ${Number(skewMs)}; })()`);
  const page = await context.newPage();
  const net = [];
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    const path = url.pathname.replace('/api/agent/web-shell/v1', '');
    const entry = { t: Date.now(), path, status: res.status() };
    try {
      entry.req = JSON.parse(res.request().postData() ?? 'null');
    } catch {}
    if (!path.includes('stream')) {
      try {
        entry.res = await res.json();
      } catch {}
    }
    net.push(entry);
  });
  page.on('requestfailed', (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    const entry = { t: Date.now(), path: url.pathname.replace('/api/agent/web-shell/v1', ''), status: 0, failure: req.failure()?.errorText };
    try {
      entry.req = JSON.parse(req.postData() ?? 'null');
    } catch {}
    net.push(entry);
  });
  const q = new URLSearchParams({ actor, lang, theme, ...(session ? { session } : {}) });
  await page.goto(`http://localhost:${PORTS[arm]}/e2e/fixtures/rig-13107.html?${q}`, { waitUntil: 'load' });
  return { page, net, context, consoleErrors, arm, actor };
}

export const card = (page) => page.locator('[data-testid="managed-approval"]');

// Selects a Session the way a user would: Refresh, then click it in the list.
export async function selectSession(page, sessionId, title) {
  await page.getByRole('button', { name: /Refresh|刷新/ }).first().click();
  const item = page.locator('nav button', { hasText: title ?? sessionId }).first();
  await item.waitFor({ state: 'visible', timeout: 15_000 });
  await item.click();
}

export async function waitCard(page, { timeoutMs = 30_000 } = {}) {
  const start = Date.now();
  try {
    await card(page).waitFor({ state: 'visible', timeout: timeoutMs });
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}
export async function waitNoCard(page, { timeoutMs = 30_000 } = {}) {
  const start = Date.now();
  try {
    await card(page).waitFor({ state: 'detached', timeout: timeoutMs });
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

export async function shot(page, name, { full = false } = {}) {
  const file = `${FIG}/${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

export const calls = (net, path) => net.filter((e) => e.path === path);
export const text = async (locator) => ((await locator.count()) ? (await locator.first().innerText()).replace(/\s+/g, ' ').trim() : null);
export { sleep, DB };
// The shared card renders its options as role="radio" elements carrying the service's option ID.
export const option = (page, id) => card(page).locator(`[data-option-id="${id}"]`);
