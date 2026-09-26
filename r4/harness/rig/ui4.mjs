// PR #12250 R4: the real Web Shell (served by the daemon) watching a detached
// Session while its background notification turn runs.  ARM=obs|m17ur node ui4.mjs
// At one instant, capture (a) the sidebar row + its details tooltip, (b) the
// row's status-dot DOM attributes, (c) the raw live-state entry for that
// Session, (d) the bundle's latest [probe-aws] line.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/git/qwen-12250-r4/package.json');
const { chromium } = require('playwright');
const env = process.env;
const ARM = env.ARM, BASE = env.BASE_URL, TOKEN = env.TOKEN, WS = env.WS;
const MOCK = `http://127.0.0.1:${env.MOCK_PORT}`;
const OUT = `${env.R}/out/ui`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (m, x) => console.log(`[ui-${ARM} +${((Date.now() - T0) / 1000).toFixed(2)}s] ${m}`, x ? JSON.stringify(x).slice(0, 400) : '');
async function api(path, { method = 'GET', body, clientId } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const mockLog = async () => (await fetch(`${MOCK}/__log`)).json();
async function until(pred, timeoutMs, what, everyMs = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const v = await pred(); if (v) return v; await sleep(everyMs); }
  throw new Error(`timeout: ${what}`);
}
const liveEntry = async (sid) => ((await api(`/workspaces/${encodeURIComponent(WS)}/sessions/live-state`)).json?.sessions ?? []).find((s) => s.sessionId === sid);

await fetch(`${MOCK}/__run`, { method: 'POST', body: JSON.stringify({ label: `${ARM}-ui` }) });
// the detached Session, driven over HTTP like an SDK client would
const created = await api('/session', { method: 'POST', body: { cwd: WS, approvalMode: 'yolo', sessionScope: 'thread' } });
const sid = created.json.sessionId, clientId = created.json.clientId;
await api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text: '[[S:bgwin]] launch alpha in the background' }] } });
await until(async () => (await mockLog()).find((r) => r.kind === 'parent' && /PARENT-DONE/.test(String(r.reply)) && r.ended), 20000, 'user turn done');
await until(async () => { const st = await api(`/session/${sid}/status`); return st.json && !st.json.hasActivePrompt && !st.json.backgroundTurn; }, 10000, 'idle');
const meta = await api(`/session/${sid}/metadata`, { method: 'PATCH', clientId, body: { displayName: 'Detached session (background turn)' } });
log('rename', { status: meta.status });
const det = await api(`/session/${sid}/detach`, { method: 'POST', clientId });
log('detached', { status: det.status });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?token=${TOKEN}&lang=en`, { waitUntil: 'domcontentloaded' });
await page.locator('.cm-content').first().waitFor({ timeout: 30000 });
const row = page.locator('[role="button"]', { has: page.locator('[data-web-shell-session-title]', { hasText: 'Detached session (background turn)' }) }).first();
await row.waitFor({ timeout: 20000 });
log('row visible');

await until(async () => (await liveEntry(sid))?.backgroundTurn, 20000, 'background turn admitted');
log('background turn admitted');
// m17ur publishes `idle` only once the child's next 15 s heartbeat replaces
// its cached hold; capture inside that stretch.  Other arms: 12 s in.
if (ARM === 'm17ur') await until(async () => (await liveEntry(sid))?.activeWorkState === 'idle', 18000, 'idle published', 200);
else await sleep(12000);
await row.hover();
await sleep(900);
const tooltip = page.locator('[data-web-shell-session-details-content]').first();
const tooltipText = (await tooltip.isVisible().catch(() => false)) ? (await tooltip.innerText()).replace(/\s+/g, ' ').slice(0, 400) : null;
const dots = await row.evaluate((el) => ({
  running: !!el.querySelector('[data-web-shell-session-running]'),
  activeWork: !!el.querySelector('[data-web-shell-session-active-work]'),
  backgroundRunning: !!el.querySelector('[data-web-shell-session-background-running]'),
  rowClass: el.className,
}));
const entry = await liveEntry(sid);
const probe = fs.readFileSync(`${env.R}/out/daemon-${ARM}.log`, 'utf8').split('\n').filter((l) => l.startsWith('[probe-aws] ') && l.includes(sid)).at(-1);
const box = await page.locator('aside, nav').first().boundingBox().catch(() => null);
await page.screenshot({ path: `${OUT}/${ARM}-sidebar-full.png` });
log('captured', { tooltipText, dots, entry: { hasActivePrompt: entry?.hasActivePrompt, activeWorkState: entry?.activeWorkState, backgroundTurn: !!entry?.backgroundTurn, clientCount: entry?.clientCount } });
fs.writeFileSync(`${OUT}/${ARM}-capture.json`, JSON.stringify({ arm: ARM, sid, tooltipText, dots, liveStateEntry: entry, probeAws: probe ? JSON.parse(probe.slice(12)) : null, sidebarBox: box }, null, 1));
await browser.close();
// let the turn finish before the daemon is stopped
await until(async () => !(await liveEntry(sid))?.backgroundTurn, 40000, 'turn end', 300).catch(() => {});
process.exit(0);
