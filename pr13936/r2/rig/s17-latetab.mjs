// S17: a second tab whose task reads are stale (frozen on the last running snapshot by a page route)
// cancels a task that tab A already got cancelled. Its POST reaches the real server and is refused.
// Then tab B's reads are unfrozen: once B sees the terminal task, is the obsolete failure removed?
// usage: ARM=merge|cand node s17-latetab.mjs <db> <tag>
import { chromium, openPage, startSampler, samples, launchChild, api, sql, sleep, out, gw } from './lib.mjs';
const [db = 'db1', tag = 'S17'] = process.argv.slice(2);
const arm = process.env.ARM ?? 'merge';
const R = (o) => out(`${tag}.jsonl`, { tag, arm, ...o });
await gw('/nodelay');
const { sid, taskId } = await launchChild(db, 'lt');
R({ step: 'launch', sid, taskId });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const A = await openPage(browser, { sid, context: ctx });
const B = await openPage(browser, { sid, context: ctx });
let frozen = false;
const last = {};
let servedFrozen = 0;
await B.page.route(/\/api\/agent\/web-shell\/v1\/tasks\/(query|get)$/, async (route) => {
  const key = route.request().url().endsWith('/get') ? 'get' : 'query';
  if (frozen && last[key]) { servedFrozen++; return route.fulfill({ status: 200, contentType: 'application/json', body: last[key] }); }
  const res = await route.fetch();
  const body = await res.text();
  if (!frozen) last[key] = body;
  await route.fulfill({ response: res, body });
});
for (const { page } of [A, B]) {
  await page.getByRole('button', { name: 'Child Agent tasks' }).click();
  const panel = page.locator('[data-managed-task-panel]');
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await panel.getByText('State history').waitFor();
}
await sleep(1500);
frozen = true;
await A.page.getByRole('button', { name: 'Request cancellation' }).click();
await A.page.getByRole('button', { name: 'Confirm cancellation' }).click();
let settled = false;
for (let i = 0; i < 600 && !settled; i++) {
  settled = (await api(db, 'GET', `/${sid}/tasks`)).json?.data?.find((x) => x.id === taskId)?.state === 'cancelled';
  if (!settled) await sleep(100);
}
await sleep(1000);
await startSampler(B.page);
const tClickB = Date.now();
await B.page.getByRole('button', { name: 'Request cancellation' }).click();
await B.page.getByRole('button', { name: 'Confirm cancellation' }).click();
await B.page.getByText('Cancellation request failed.').first().waitFor({ timeout: 15000 }).catch(() => {});
await sleep(2000);
await B.page.screenshot({ path: `shots/${tag}-01-refused.png` });
const tUnfreeze = Date.now();
frozen = false;
await sleep(9000);
await B.page.screenshot({ path: `shots/${tag}-02-after-unfreeze.png` });
const smp = await samples(B.page);
const failedSeen = smp.filter((s) => /Cancellation request failed/.test(s.text));
const lastSample = smp.at(-1)?.text ?? '';
const firstCancelledB = smp.find((s) => /Cancelled/.test(s.text.split('|| HEADER')[0]));
R({
  step: 'result', sid, taskId, serverSettledBeforeBClick: settled, servedFrozen,
  bPosts: B.net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel').length,
  bResponses: B.net.filter((n) => n.kind === 'res' && n.path === '/tasks/cancel').map((n) => `${n.status} ${n.body.slice(0, 120)}`),
  failedFirstMs: failedSeen[0] ? failedSeen[0].t - tClickB : null,
  failedLastMs: failedSeen.at(-1) ? failedSeen.at(-1).t - tClickB : null,
  unfreezeMs: tUnfreeze - tClickB,
  bCancelledMs: firstCancelledB ? firstCancelledB.t - tClickB : null,
  failedStillShownAtEnd: /Cancellation request failed/.test(lastSample),
  endText: lastSample.replace(/Created.*?State history/, '…').slice(0, 260),
  dbOps: sql(db, `SELECT GROUP_CONCAT(CONCAT(state,'/',IFNULL(error_code,'-'))) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`),
  errors: B.errors.filter((e) => !/409|status of 4/.test(e)).slice(0, 3),
});
await browser.close();
process.exit(0);
