// Web Shell driver for PR 11644: real `qwen serve` + real Chromium, with a
// wire-level recorder of every browser→daemon request (the traffic oracle).
import pw from '/root/git/pr11644/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

export const PORT = process.env.PORT || '4644';
export const TOKEN = process.env.TOKEN || 'T0KEN11644';
export const BASE = `http://127.0.0.1:${PORT}`;
export const UI_URL = `${BASE}/#token=${TOKEN}`;
export const WS = {
  '/root/git/h11644/ws/alpha-app': 'alpha',
  '/root/git/h11644/ws/beta-lib': 'beta',
  '/root/git/h11644/ws/gamma-docs': 'gamma',
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function classify(method, rawUrl) {
  const u = new URL(rawUrl);
  if (u.origin !== BASE) return null;
  let p = u.pathname;
  let ws = '-';
  const m = p.match(/^\/workspaces\/([^/]+)(\/.*)?$/);
  if (m) {
    const cwd = decodeURIComponent(m[1]);
    ws = WS[cwd] ?? cwd;
    p = m[2] || '/';
  } else if (p.startsWith('/workspace/')) {
    ws = 'unqualified';
    p = p.slice('/workspace'.length);
  }
  let kind = 'other';
  if (u.pathname === '/capabilities') kind = 'capabilities';
  else if (u.pathname === '/live/setup') kind = 'live-setup';
  else if (method === 'GET' && ['/mcp', '/extensions', '/channels', '/memory', '/hooks'].includes(p)) kind = `facet:${p.slice(1)}`;
  else if (method === 'GET' && p === '/skills') kind = 'skills';
  else if (method === 'GET' && p === '/git') kind = u.searchParams.get('wait') ? 'git?wait' : 'git';
  else if (method === 'GET' && p === '/providers') kind = 'providers';
  else if (method === 'GET' && p === '/sessions') kind = 'sessions-list';
  else if (/\/assets\/|\.(js|css|svg|png|woff2?)$/.test(u.pathname) || u.pathname === '/') kind = 'static';
  return { method, path: u.pathname + u.search, ws, kind, p };
}

export async function launch({ locale = 'en-US', width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale });
  const page = await context.newPage();
  const t0 = Date.now();
  const reqs = [];
  page.on('request', (r) => {
    const c = classify(r.method(), r.url());
    if (c && c.kind !== 'static') reqs.push({ t: Date.now() - t0, ...c });
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { browser, context, page, reqs, t0 };
}

export function summarize(reqs, from = 0, to = Infinity) {
  const out = {};
  for (const r of reqs) {
    if (r.t < from || r.t >= to) continue;
    const key = `${r.kind} @${r.ws}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort());
}

export function count(reqs, pred, from = 0, to = Infinity) {
  return reqs.filter((r) => r.t >= from && r.t < to && pred(r)).length;
}

export const isFacet = (r) => r.kind.startsWith('facet:');
export const isGit = (r) => r.kind === 'git' || r.kind === 'git?wait';

export async function openUi(page) {
  await page.goto(UI_URL);
  await page.getByRole('complementary').first().waitFor({ timeout: 30000 });
}

export function save(name, data) {
  fs.writeFileSync(`/root/git/h11644/out/${process.env.OUTDIR || ''}${name}.json`, JSON.stringify(data, null, 2));
}
