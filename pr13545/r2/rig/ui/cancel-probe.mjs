// What the head page does when a READER presses the always-offered "Cancel turn".
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/pr13545-rig/src-head/package.json');
const { chromium } = require('playwright');
const RIG = '/Users/wenshao/pr13545-rig';
const arm = process.argv[2] ?? 'head';
const st = JSON.parse(fs.readFileSync(`${RIG}/state/serve-${arm}.json`, 'utf8'));
const port = arm === 'head' ? 5545 : 5546;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(actor, method, p, body) {
  const r = await fetch(`http://127.0.0.1:${st.springPort}${p}`, { method, headers: { 'x-qwen-tenant-id': 'rig-tenant', 'x-rig-actor': actor, 'content-type': 'application/json', 'idempotency-key': `cp-${randomBytes(4).toString('hex')}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const marker = `RIG_WRITE_c${randomBytes(3).toString('hex')}`;
const pre = await api('cr', 'GET', `/v1/agents/sessions/${st.SU}/actions`);
let req = (pre.json?.data ?? []).find((x) => x.state === 'requested');
const s = req ? { json: { turn_id: req.turn_id } } : await api('cr', 'POST', `/v1/agents/sessions/${st.SU}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `please ${marker}` }] });
for (let i = 0; i < 80 && !req; i++) { const a = await api('cr', 'GET', `/v1/agents/sessions/${st.SU}/actions`); req = (a.json?.data ?? []).find((x) => x.state === 'requested'); if (!req) await sleep(250); }
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const net = [];
page.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/turns/cancel')) net.push(`${r.status()} ${JSON.stringify(await r.json().catch(() => null))}`); });
await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13545.html?actor=rd&tenant=rig-tenant&session=${st.SU}`);
await page.getByRole('button', { name: /Cancel turn/ }).waitFor({ timeout: 20000 });
await sleep(1000);
await page.getByRole('button', { name: /Cancel turn/ }).click();
await sleep(2500);
const alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts();
await page.screenshot({ path: `${RIG}/fig/raw/ui-${arm}-u4-reader-cancel.png` });
console.log(JSON.stringify({ arm, cancel: net, alerts: alerts.filter((t) => (t ?? '').trim()).slice(0, 5), turn: s.json?.turn_id }));
await browser.close();
const r = await api('cr', 'POST', `/v1/agents/sessions/${st.SU}/actions/${req.id}/responses`, { kind: 'permission', option_id: 'allow', input_revision: req.input_revision, policy_revision: req.policy_revision });
console.log('cleanup respond', r.status);
