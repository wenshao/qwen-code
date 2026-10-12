// S7 narrow Dialog + focus | S8 read-only host | S9 old server (no tasks capability) | S10 zh-CN
// S11 two tabs | S12 kind filter (shell row injected into the real page) | S13 before/after (base vs merge)
// usage: node s7-misc.mjs <db> <tag>
import { chromium, openPage, launchChild, api, sql, sleep, out, gw } from './lib.mjs';

const [db = 'db1', tag = 'S7'] = process.argv.slice(2);
const R = (o) => out(`${tag}.jsonl`, { tag, ...o });
await gw('/nodelay');
const { sid, taskId, id } = await launchChild(db, tag.toLowerCase());
R({ step: 'launch', sid, taskId });
const browser = await chromium.launch();
const panelSel = '[data-managed-task-panel]';

if (tag === 'S7') {
  const { page, errors } = await openPage(browser, { sid, width: 900, height: 900 });
  const entry = page.getByRole('button', { name: 'Child Agent tasks' });
  await entry.click();
  const dialog = page.locator('[data-managed-task-panel="dialog"]');
  await dialog.getByRole('button', { name: /Child Agent · / }).first().waitFor({ timeout: 20000 });
  await sleep(1200);
  const role = await page.getByRole('dialog').count();
  await page.screenshot({ path: `shots/${tag}-01-narrow-dialog.png` });
  await page.keyboard.press('Escape');
  await sleep(500);
  const focusEsc = await page.evaluate(() => document.activeElement?.textContent);
  const dialogGone = (await page.getByRole('dialog').count()) === 0;
  // wide: Close tasks returns focus to the entry
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(500);
  await entry.click();
  const side = page.locator('[data-managed-task-panel="side"]');
  await side.waitFor({ timeout: 10000 });
  const width = await side.evaluate((e) => e.getBoundingClientRect().width);
  await side.getByRole('button', { name: 'Close tasks' }).click();
  await sleep(300);
  const focusClose = await page.evaluate(() => document.activeElement?.textContent);
  R({ step: 'result', dialogRole: role, dialogGoneOnEscape: dialogGone, focusAfterEscape: focusEsc, sidePanelWidth: width, focusAfterClose: focusClose, errors });
} else if (tag === 'S8') {
  const { page, net, errors } = await openPage(browser, { sid, scope: '' });
  await page.getByRole('button', { name: 'Child Agent tasks' }).click();
  const panel = page.locator(panelSel);
  await panel.getByRole('button', { name: /Child Agent · / }).first().waitFor({ timeout: 20000 });
  await panel.getByText('Running').first().waitFor();
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await panel.getByText('State history').waitFor();
  await sleep(1500);
  await page.screenshot({ path: `shots/${tag}-01-read-only.png` });
  R({ step: 'result', cancelButtons: await page.getByRole('button', { name: 'Request cancellation' }).count(), taskReads: net.filter((n) => n.kind === 'res' && n.path.startsWith('/tasks/')).length, cancelPosts: net.filter((n) => n.path === '/tasks/cancel').length, panel: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 220), errors });
} else if (tag === 'S9') {
  // an older Java server: same session views without capabilities.tasks
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  let stripped = 0;
  await ctx.route(/\/api\/agent\/web-shell\/v1\/sessions\/(get|query)$/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    const strip = (s) => { if (s?.capabilities && 'tasks' in s.capabilities) { delete s.capabilities.tasks; stripped++; } };
    if (Array.isArray(j.data)) j.data.forEach(strip); else strip(j);
    await route.fulfill({ response: res, json: j });
  });
  const { page, net, errors } = await openPage(browser, { sid, context: ctx });
  await page.getByText('Bound Workspace').first().waitFor({ timeout: 20000 });
  await sleep(4000);
  await page.screenshot({ path: `shots/${tag}-01-old-server.png` });
  R({ step: 'result', stripped, entryButtons: await page.getByRole('button', { name: 'Child Agent tasks' }).count(), taskRequests: net.filter((n) => n.path.startsWith('/tasks/')).length, errors });
} else if (tag === 'S10') {
  const { page, errors } = await openPage(browser, { sid, lang: 'zh-CN' });
  const entry = page.getByRole('button', { name: '子 Agent 任务' });
  const found = await entry.waitFor({ timeout: 20000 }).then(() => true, () => false);
  const btns = await page.getByRole('button').allInnerTexts();
  if (found) {
    await entry.click();
    const panel = page.locator(panelSel);
    await panel.getByRole('button').nth(3).waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(2000);
    const rows = panel.locator('button').filter({ hasText: /·/ });
    if (await rows.count()) await rows.first().click();
    await sleep(2500);
    await page.screenshot({ path: `shots/${tag}-01-zh.png` });
    R({ step: 'result', panel: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 400), rawKeys: /managed\.tasks\./.test(await page.content()), errors });
  } else R({ step: 'result', found, btns: btns.slice(0, 20), errors });
} else if (tag === 'S11') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const tabs = [await openPage(browser, { sid, context: ctx }), await openPage(browser, { sid, context: ctx })];
  for (const { page } of tabs) {
    await page.getByRole('button', { name: 'Child Agent tasks' }).click();
    const panel = page.locator(panelSel);
    await panel.getByRole('button', { name: /Child Agent · / }).first().click();
    await panel.getByText('State history').waitFor();
    await page.getByRole('button', { name: 'Request cancellation' }).click();
  }
  await Promise.all(tabs.map(({ page }) => page.getByRole('button', { name: 'Confirm cancellation' }).click()));
  for (const { page } of tabs) await page.waitForFunction(() => /Cancelled/.test(document.querySelector('[data-managed-task-panel] .break-all.font-medium')?.parentElement?.innerText ?? ''), null, { timeout: 60000 }).catch(() => {});
  await sleep(4000);
  await tabs[0].page.screenshot({ path: `shots/${tag}-01-tab1.png` });
  await tabs[1].page.screenshot({ path: `shots/${tag}-02-tab2.png` });
  R({
    step: 'result',
    tabs: await Promise.all(tabs.map(async ({ page, net, errors }, i) => ({
      tab: i + 1,
      posts: net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel').map((n) => JSON.parse(n.body).idempotencyKey),
      responses: net.filter((n) => n.kind === 'res' && n.path === '/tasks/cancel').map((n) => `${n.status} ${n.body.slice(0, 160)}`),
      panel: (await page.locator(panelSel).innerText()).replace(/\s+/g, ' ').slice(0, 260),
      header: (await page.locator('span[role="status"]').allInnerTexts()).join(' | '),
      errors,
    }))),
    dbOps: sql(db, `SELECT GROUP_CONCAT(CONCAT(operation_id,' ',state,'/',IFNULL(error_code,'-'))) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`),
  });
} else if (tag === 'S12') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  let injected = 0;
  await ctx.route(/\/api\/agent\/web-shell\/v1\/tasks\/query$/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    const child = j.data.find((t) => t.kind === 'child_agent');
    if (child) { j.data.unshift({ ...child, taskId: 'task_shell_injected_0001', kind: 'shell', state: 'running' }); injected++; }
    await route.fulfill({ response: res, json: j });
  });
  const { page, errors } = await openPage(browser, { sid, context: ctx });
  await page.getByRole('button', { name: 'Child Agent tasks' }).click();
  const panel = page.locator(panelSel);
  await panel.getByRole('button', { name: /Child Agent · / }).first().waitFor({ timeout: 20000 });
  await sleep(2000);
  R({ step: 'result', injected, rowsShown: await panel.getByRole('button', { name: /Child Agent · / }).count(), shellShown: (await panel.innerText()).includes('shell_inj'), errors });
} else if (tag === 'S13') {
  const res = {};
  for (const arm of ['base', 'merge']) {
    const { page, net, errors } = await openPage(browser, { sid, arm });
    await page.getByText('Bound Workspace').first().waitFor({ timeout: 30000 });
    await sleep(3000);
    const entry = page.getByRole('button', { name: 'Child Agent tasks' });
    const n = await entry.count();
    if (n) { await entry.click(); await page.locator(panelSel).getByText('Running').first().waitFor({ timeout: 20000 }); await sleep(1500); }
    await page.screenshot({ path: `shots/${tag}-${arm}.png` });
    res[arm] = { entryButtons: n, taskRequests: net.filter((x) => x.path.startsWith('/tasks/')).length, errors };
    await page.close();
  }
  R({ step: 'result', ...res });
}
await browser.close();
process.exit(0);
