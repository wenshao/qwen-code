// Shared Playwright helpers for the PR 12404 round-2 harness.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/root/verify/pr12404-r2/package.json');
const { chromium } = require('playwright-core');
export const PORT = Number(process.env.PORT || 4414);
export const TOKEN = process.env.TOKEN || 'T0KEN12404R2';
export const BASE = `http://127.0.0.1:${PORT}`;
export const UI_URL = `${BASE}/#token=${TOKEN}`;
export const WS = '/root/verify/pr12404-r2-e2e/ws/demo-app';
export const OUT = process.env.OUT || '/root/verify/pr12404-r2-e2e/out';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const save = (name, obj) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(obj, null, 1));
export async function launch(viewport = { width: 1400, height: 900 }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const log = [];
  const wire = [];
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[console.${m.type()}] ${m.text().slice(0, 400)}`); });
  page.on('response', (r) => { const u = new URL(r.url()); if (/\/(load|transcript|prompt|file)$|\/file\b/.test(u.pathname)) wire.push({ status: r.status(), method: r.request().method(), path: u.pathname + (u.search ? u.search.replace(/token=[^&]+/, 'token=…') : '') }); });
  return { browser, context, page, log, wire };
}
export async function userTags(page) {
  return page.locator('[class*="chatBubble"] [class*="messageTag"]').evaluateAll((els) => els.filter((e) => !e.parentElement.closest('[class*="messageTag"]')).map((e) => {
    const cs = getComputedStyle(e);
    return { text: e.textContent.trim(), h: e.getBoundingClientRect().height, padR: cs.paddingRight, radius: cs.borderRadius, font: cs.fontFamily.split(',')[0], bg: cs.backgroundColor, role: e.getAttribute('role') };
  }));
}
export async function userBubbleTexts(page) {
  return page.locator('[class*="chatBubble"]').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)));
}
