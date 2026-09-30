// b6b: what the output panel shows while the server's four read slots are busy (another user's downloads).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, open, SHOTS, expandShell, waitPage, rig } from './pw.mjs';
L.openLog('b6b-busy');
const browser = await chromium.launch();
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const big = s4.find((r) => r.case === 'log100');
const a = (await L.api('GET', `/v1/agents/sessions/${big.session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
const holds = [];
for (let i = 0; i < 4; i++) {
  const ac = new AbortController();
  const res = await fetch(`${L.BASE}/v1/agents/sessions/${big.session}/artifacts/${a.id}/content?revision=${a.revision}`, { headers: L.headers({}), signal: ac.signal });
  holds.push({ ac, res, reader: res.body.getReader() }); // keep references: unread bodies are cancelled when collected
}
L.say('held downloads', holds.map((h) => h.res.status));
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const { page } = await open(browser, s1.find((r) => r.case === 'ok').session, '&save=opfs');
await expandShell(page);
const t0 = Date.now();
await page.getByRole('button', { name: 'View output' }).first().click();
await page.locator('[role=dialog]').waitFor();
await page.waitForFunction(() => !/Reading output|Loading/.test(document.querySelector('[role=dialog]')?.textContent ?? 'Loading'), null, { timeout: 60000 });
let r = await rig(page);
L.say('panel while 4 downloads hold the read slots', { ms: Date.now() - t0, contentRequests: r.requests.map((q) => q.status), alert: await page.locator('[role=dialog] [role=alert]').allInnerTexts(), bytesShown: await page.locator('[role=dialog] pre[data-managed-output-bytes]').count() });
await page.screenshot({ path: `${SHOTS}/b6-429-panel.png` });
for (const h of holds) h.ac.abort();
await page.waitForTimeout(1500);
await page.locator('[role=dialog]').getByRole('button', { name: 'Refresh output' }).click();
await waitPage(page);
L.say('after the slots are free, Refresh output', (await page.locator('[role=dialog] pre[data-managed-output-bytes]').innerText()).trim());
await browser.close();
