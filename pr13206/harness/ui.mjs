// VERIFICATION RIG ONLY (PR #13206): Playwright helpers that drive the real Managed panel.
// The page is the rig host fixture (client/e2e/fixtures/rig-13206.html) served by vite from the
// trial-merge worktree (arm "head") or the main worktree (arm "base"); both go through the wire to
// the same Java server.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { RIG, DB, sleep } from './lib.mjs';

const require = createRequire(`${RIG}/wt-head/package.json`);
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

export const launch = () => chromium.launch({ headless: true });

// Opens the host page on a session. Returns { page, net, warnings, errors }.
export async function open(browser, { arm = 'head', actor = 'alice', lang = 'en', session, width = 1180, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const net = [];
  const warnings = [];
  const errors = [];
  page.on('console', (m) => {
    const entry = { t: Date.now(), type: m.type(), text: m.text().slice(0, 400) };
    if (m.type() === 'warning') warnings.push(entry);
    if (m.type() === 'error') errors.push(entry);
  });
  page.on('pageerror', (e) => errors.push({ t: Date.now(), type: 'pageerror', text: String(e).slice(0, 400) }));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    let body;
    try {
      body = JSON.parse(req.postData() ?? 'null');
    } catch {}
    net.push({ t: Date.now(), path: url.pathname.replace('/api/agent/web-shell/v1', ''), body });
  });
  const q = new URLSearchParams({ actor, lang, ...(session ? { session } : {}) });
  await page.goto(`http://localhost:${PORTS[arm]}/e2e/fixtures/rig-13206.html?${q}`, { waitUntil: 'load' });
  return { page, net, warnings, errors, context, arm };
}

// Text of every rendered message row, in DOM order.
export async function rows(page) {
  return page.locator('[data-message-row-key]').evaluateAll((els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
}
// Chunk markers ("[T-001]") in the whole rendered transcript, in order.
export async function markers(page, tag) {
  const text = await page.locator('body').innerText();
  return [...text.matchAll(new RegExp(`\\[${tag}-(\\d{3})\\]`, 'g'))].map((m) => Number(m[1]));
}
export function analyse(nums, n) {
  const seen = new Map();
  for (const x of nums) seen.set(x, (seen.get(x) ?? 0) + 1);
  const missing = [];
  for (let i = 1; i <= n; i++) if (!seen.has(i)) missing.push(i);
  const dup = [...seen].filter(([, c]) => c > 1).map(([x]) => x);
  const ordered = nums.every((x, i) => i === 0 || x > nums[i - 1]);
  return { count: nums.length, distinct: seen.size, missing, dup, ordered, max: Math.max(0, ...nums) };
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
export const streamCalls = (net) => net.filter((e) => e.path === '/events/stream');
export const transcriptCalls = (net) => net.filter((e) => e.path === '/transcript/query');
export { sleep, DB };
