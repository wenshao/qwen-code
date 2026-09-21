// Web Shell driver for PR 12404: real `qwen serve` + real Chromium.
import pw from '/root/git/h12404/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;
export const PORT = process.env.PORT || '4404';
export const TOKEN = process.env.TOKEN || 'T0KEN12404';
export const BASE = `http://127.0.0.1:${PORT}`;
export const UI_URL = `${BASE}/#token=${TOKEN}`;
export const WS = '/root/git/h12404-e2e/ws/demo-app';
export const OUT = '/root/git/h12404-e2e/out';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

export async function launch({ width = 1280, height = 820, colorScheme = 'light' } = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'en-US', colorScheme });
  const page = await context.newPage();
  const log = [];
  page.on('pageerror', (e) => { log.push(`[pageerror] ${e.message}`); console.log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
  const wire = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.startsWith(BASE)) return;
    const p = new URL(u).pathname;
    if (/\/(load|transcript|history|events|file)\b|\/prompt$/.test(p)) wire.push({ status: r.status(), method: r.request().method(), path: p + new URL(u).search });
  });
  return { browser, context, page, log, wire };
}

// Tags rendered inside user messages (CSS-module class contains "messageTag").
export async function userTags(page) {
  return page.$$eval('[class*="messageTag"]:not([class*="messageTagIcon"]):not([class*="messageTagLabel"]):not([class*="messageTagValue"]):not([class*="messageTagTooltip"])', (els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), title: el.getAttribute('title'), role: el.getAttribute('role'),
        h: Math.round(r.height), w: Math.round(r.width), radius: cs.borderRadius, padR: cs.paddingRight,
        font: cs.fontFamily.split(',')[0], bg: cs.backgroundColor, va: cs.verticalAlign, cls: el.className };
    }));
}

export async function userBubbleTexts(page) {
  return page.$$eval('[class*="chatBubble"]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
}

export function save(name, obj) { fs.writeFileSync(`${OUT}/${name}`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); }
