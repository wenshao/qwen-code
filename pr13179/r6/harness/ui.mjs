// VERIFICATION RIG ONLY (PR #13179): Playwright helpers that drive the real Managed panel.
// The page is the rig host fixture served by vite from the trial-merge worktree (arm "head") or the
// main worktree (arm "base"); each arm goes through its own wire to the same Java server.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { RIG, DB, sleep, vitePort } from './lib.mjs';

const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
export const FIG = `${RIG}/fig/raw`;
fs.mkdirSync(FIG, { recursive: true });
export const launch = () => chromium.launch({ headless: true });

// Opens the host page. Returns { page, net, errors, context, arm }; net records every adapter request with its outcome.
export async function open(browser, { arm = 'head', actor = 'alice', lang = 'en', session, noauth = false, api, width = 1180, height = 860, scale = 2 } = {}) {
  // Direct mode talks to the wire cross-origin; the dev server's CSP (connect-src 'self') would block it.
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, ...(api ? { bypassCSP: true } : {}) });
  const page = await context.newPage();
  const net = [];
  const errors = [];
  const byReq = new Map();
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ t: Date.now(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => errors.push({ t: Date.now(), type: 'pageerror', text: String(e).slice(0, 300) }));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/agent/web-shell/v1/') || req.method() === 'OPTIONS') return;
    const e = { t: Date.now(), path: url.pathname.replace('/api/agent/web-shell/v1', '') };
    byReq.set(req, e);
    net.push(e);
  });
  page.on('response', (res) => { const e = byReq.get(res.request()); if (e) { e.status = res.status(); e.tr = Date.now(); } });
  page.on('requestfailed', (req) => { const e = byReq.get(req); if (e) { e.failed = req.failure()?.errorText ?? 'failed'; e.tr = Date.now(); } });
  const q = new URLSearchParams({ actor, lang, ...(session ? { session } : {}), ...(noauth ? { noauth: '1' } : {}), ...(api ? { api } : {}) });
  await page.goto(`http://localhost:${vitePort(arm)}/e2e/fixtures/rig-13179.html?${q}`, { waitUntil: 'load' });
  return { page, net, errors, context, arm };
}
export const alertText = async (page) => {
  const loc = page.locator('[role="alert"]');
  const n = await loc.count();
  const out = [];
  for (let i = 0; i < n; i++) out.push((await loc.nth(i).innerText()).trim());
  return out.filter(Boolean);
};
export async function shot(page, name, opts = {}) {
  const file = `${FIG}/${name}.png`;
  await page.screenshot({ path: file, ...opts });
  return file;
}
// Requests per adapter path within [from, to).
export function counts(net, from = 0, to = Infinity) {
  const out = {};
  for (const e of net) if (e.t >= from && e.t < to) out[e.path] = (out[e.path] ?? 0) + 1;
  return out;
}
export const gaps = (ts) => ts.slice(1).map((t, i) => t - ts[i]);
export { sleep, DB };
