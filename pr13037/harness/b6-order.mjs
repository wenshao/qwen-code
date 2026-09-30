// b6: (1) where the Shell card lands relative to the final answer, for an instant model and for a model that
//     needs 4 s to answer; (2) what the panel shows while the server's four read slots are busy.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, open, SHOTS, transcript, expandShell, openPanel, waitPage, rig } from './pw.mjs';
L.openLog('b6-order');
const browser = await chromium.launch();
const cmd = 'echo "42 tests passed"; echo "1 test skipped" >&2';
const runs = [];
for (const [label, n, extra] of [['model answers instantly', '55', ''], ['model answers after 4 s', '56', ' [O3_DELAY:4000]'], ['model answers after 4 s (repeat)', '57', ' [O3_DELAY:4000]']]) {
  L.register(`ws-b6b-${n}`, `st-s${n}`);
  const session = await L.createShellSession(`ws-b6b-${n}`, `${L.shellPrompt('Run the tests', cmd)}${extra}`);
  const { page, context } = await open(browser, session, '&save=opfs');
  await page.getByText('Shell', { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {});
  const during = (await transcript(page)).replace(/^.*?\] \| /, '').replace(/ \[O3_DELAY:\d+\]/, '');
  await L.waitTurn(session);
  await page.waitForTimeout(2500);
  const live = (await transcript(page)).replace(/^.*?\] \| /, '').replace(/ \[O3_DELAY:\d+\]/, '');
  const collapsedDefault = (await page.getByText('Shell', { exact: true }).count()) === 0;
  await page.screenshot({ path: `${SHOTS}/b6-order-${n}-live.png` });
  await page.reload({ waitUntil: 'load' });
  await page.getByText(/tool calls?$/).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const restored = (await transcript(page)).replace(/^.*?\] \| /, '').replace(/ \[O3_DELAY:\d+\]/, '');
  const ev = (await L.events(session)).map((e) => e.type.replace('item.', '').replace('.updated', '').replace('.delta', ''));
  const row = { label, whenTheCardFirstAppeared: during, events: ev.slice(5).join(' > '), live, restored, toolGroupCollapsedByDefault: collapsedDefault };
  runs.push(row);
  L.say('order', row);
  await context.close();
}
// (2) reader slots busy
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const big = s4.find((r) => r.case === 'log100');
const a = (await L.api('GET', `/v1/agents/sessions/${big.session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
const holds = [];
for (let i = 0; i < 4; i++) {
  const ac = new AbortController();
  holds.push(ac);
  const h = await fetch(`${L.BASE}/v1/agents/sessions/${big.session}/artifacts/${a.id}/content?revision=${a.revision}`, { headers: L.headers({}), signal: ac.signal });
  L.say('held download', h.status);
}
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const { page } = await open(browser, s1.find((r) => r.case === 'ok').session, '&save=opfs');
await expandShell(page);
const t0 = Date.now();
await page.getByRole('button', { name: 'View output' }).first().click();
await page.locator('[role=dialog]').waitFor();
await page.waitForFunction(() => !/Reading output|Loading/.test(document.querySelector('[role=dialog]')?.textContent ?? 'Loading'), null, { timeout: 60000 });
const r = await rig(page);
L.say('panel while 4 downloads hold the read slots', { ms: Date.now() - t0, contentRequests: r.requests.map((q) => q.status), alert: await page.locator('[role=dialog] [role=alert]').allInnerTexts(), bytesShown: await page.locator('[role=dialog] pre[data-managed-output-bytes]').count() });
await page.screenshot({ path: `${SHOTS}/b6-429-panel.png` });
for (const ac of holds) ac.abort();
await page.waitForTimeout(1500);
await page.locator('[role=dialog]').getByRole('button', { name: 'Refresh output' }).click();
await waitPage(page);
L.say('after the slots are free, Refresh output', (await page.locator('[role=dialog] pre[data-managed-output-bytes]').innerText()).trim());
await browser.close();
