// S2: after the cancel hook observes the terminal task it clears its state before the panel's own
// snapshot refreshes. With a slow task list (gateway delays /tasks/query), the stale Running snapshot
// shows an enabled "Request cancellation" again. Clicking it sends a second cancel for a settled task.
// usage: node s2-stale.mjs <db> <tag> <listDelayMs> [click=1]
import { chromium, openPage, startSampler, samples, createParent, driveTurn, api, sql, sleep, out, gw } from './lib.mjs';

const [db = 'db1', tag = 'S2', delayMs = '2500', click = '1'] = process.argv.slice(2);
const id = 'st' + Date.now().toString(36);
const R = (o) => out(`${tag}.jsonl`, { tag, ...o });
await gw('/nodelay');
const sid = await createParent(db, `PARENT::bg::${id}::hold start the background child`);
const launch = await driveTurn(db, sid);
let taskId;
for (let i = 0; i < 60 && !taskId; i++) {
  const t = await api(db, 'GET', `/${sid}/tasks`);
  taskId = t.json?.data?.find((x) => x.kind === 'child_agent' && x.state === 'running')?.id;
  if (!taskId) await sleep(1000);
}
R({ step: 'launch', sid, launch, taskId });
const browser = await chromium.launch();
const { page, net, errors } = await openPage(browser, { sid, arm: process.env.ARM ?? 'merge' });
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
const panel = page.locator('[data-managed-task-panel]');
await panel.getByRole('button', { name: /Child Agent · / }).first().click();
await panel.getByText('State history').waitFor();
await sleep(1500);
await gw(`/delay?path=/tasks/query&ms=${delayMs}`);
await startSampler(page);
await page.getByRole('button', { name: 'Request cancellation' }).click();
const tClick = Date.now();
await page.getByRole('button', { name: 'Confirm cancellation' }).click();
await page.getByText('Stop requested. Waiting for the task to end.').first().waitFor({ timeout: 20000 });
const tStop = Date.now();
// the stale window: the button is back while the badge still says Running
const reopened = await page.getByRole('button', { name: 'Request cancellation' }).waitFor({ timeout: 60000 }).then(() => Date.now(), () => null);
let shot = null;
if (reopened) {
  const badge = await panel.locator('.break-all.font-medium').locator('xpath=following-sibling::*[1]').innerText().catch(() => '?');
  shot = `shots/${tag}-01-stale-button.png`;
  await page.screenshot({ path: shot });
  R({ step: 'stale', msAfterClick: reopened - tClick, badge, serverTask: (await api(db, 'GET', `/${sid}/tasks`)).json?.data?.map((x) => x.state) });
  if (click === '1') {
    await page.getByRole('button', { name: 'Request cancellation' }).click();
    await page.getByRole('button', { name: 'Confirm cancellation' }).click({ timeout: 3000 }).catch((e) => R({ step: 'confirm-click-failed', e: String(e).slice(0, 200) }));
  }
}
await gw('/nodelay');
await sleep(8000);
await page.screenshot({ path: `shots/${tag}-02-after.png` });
const smp = await samples(page);
const posts = net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel').map((n) => ({ t: n.t - tClick, key: JSON.parse(n.body).idempotencyKey }));
const cancelRes = net.filter((n) => n.kind === 'res' && n.path === '/tasks/cancel').map((n) => ({ t: n.t - tClick, http: n.status, body: n.body.slice(0, 300) }));
const staleSamples = smp.filter((s) => s.t > tStop && /Running/.test(s.text) && /Request cancellation/.test(s.text));
R({
  step: 'result', sid, taskId, delayMs: Number(delayMs),
  staleWindowMs: staleSamples.length ? staleSamples.at(-1).t - staleSamples[0].t + 50 : 0,
  staleFirstMsAfterClick: staleSamples[0] ? staleSamples[0].t - tClick : null,
  cancelPosts: posts, cancelResponses: cancelRes,
  finalPanel: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 400),
  dbOps: sql(db, `SELECT GROUP_CONCAT(CONCAT(state,'/',IFNULL(error_code,'-'))) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`),
  errors,
});
await browser.close();
process.exit(0);
