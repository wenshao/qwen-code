// S3: the cancel POST is admitted by Spring but its reply is lost (gateway destroys the socket after
// Spring answered). Then reload, check nothing is re-sent on its own, click "Continue confirming":
// the replay must carry the original idempotency key and land on the same operation.
// usage: node s3-lost.mjs <db> <tag>
import { chromium, openPage, startSampler, samples, createParent, driveTurn, api, sql, sleep, out, gw, gwLog } from './lib.mjs';

const [db = 'db1', tag = 'S3'] = process.argv.slice(2);
const id = 'lo' + Date.now().toString(36);
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
const { page, net, errors } = await openPage(browser, { sid });
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
const panel = page.locator('[data-managed-task-panel]');
await panel.getByRole('button', { name: /Child Agent · / }).first().click();
await panel.getByText('State history').waitFor();
await sleep(1000);
R({ step: 'arm', gw: await gw('/arm?drop=/tasks/cancel') });
await page.getByRole('button', { name: 'Request cancellation' }).click();
const tClick = Date.now();
await page.getByRole('button', { name: 'Confirm cancellation' }).click();
await page.getByText('Cancellation result is unconfirmed.').first().waitFor({ timeout: 20000 });
await page.screenshot({ path: `shots/${tag}-01-unconfirmed.png` });
const storedBefore = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).filter((k) => k.startsWith('qwen-managed-task-cancel')).map((k) => [k, sessionStorage.getItem(k)])));
// let the server settle the admitted stop while the page still does not know the outcome
let serverState = '';
for (let i = 0; i < 60; i++) {
  serverState = (await api(db, 'GET', `/${sid}/tasks`)).json?.data?.find((x) => x.id === taskId)?.state;
  if (serverState === 'cancelled') break;
  await sleep(1000);
}
const postsBeforeReload = net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel').length;
await page.reload();
const tReload = Date.now();
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
await panel.getByText('Cancellation result is unconfirmed.').first().waitFor({ timeout: 20000 });
await sleep(7000); // two poll periods: nothing may be re-sent without the user
const postsAfterReloadIdle = net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel' && n.t > tReload).length;
await page.screenshot({ path: `shots/${tag}-02-after-reload.png` });
const listText = (await panel.innerText()).replace(/\s+/g, ' ');
await startSampler(page);
const tContinue = Date.now();
await panel.getByRole('button', { name: 'Continue confirming' }).first().click();
await page.waitForFunction(() => !document.body.innerText.includes('Cancellation result is unconfirmed.'), null, { timeout: 30000 }).catch(() => {});
await sleep(3500);
await page.screenshot({ path: `shots/${tag}-03-after-continue.png` });
const posts = net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel').map((n) => ({ t: n.t - tClick, key: JSON.parse(n.body).idempotencyKey, requestId: JSON.parse(n.body).requestId }));
const browserRes = net.filter((n) => (n.kind === 'res' || n.kind === 'fail') && (n.path === '/tasks/cancel' || n.path === '/operations/query')).map((n) => ({ t: n.t - tClick, path: n.path, kind: n.kind, http: n.status, err: n.error, body: (n.body ?? '').slice(0, 260) }));
const serverSide = gwLog(db).filter((e) => e.u?.includes('/tasks/cancel') && e.req.includes(taskId)).map((e) => ({ t: e.t, s: e.s, dropped: e.dropped, key: JSON.parse(e.req).idempotencyKey, res: e.res.slice(0, 260) }));
R({
  step: 'result', sid, taskId,
  storedIntentAfterLoss: storedBefore,
  serverStateBeforeReload: serverState,
  postsBeforeReload, postsAfterReloadIdle,
  panelAfterReload: listText.slice(0, 400),
  posts, browserResponses: browserRes, gatewaySeen: serverSide,
  sameKey: posts.length === 2 && posts[0].key === posts[1].key,
  finalPanel: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 300),
  storedAfter: await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('qwen-managed-task-cancel')).length),
  dbOps: sql(db, `SELECT GROUP_CONCAT(CONCAT(operation_id,' ',state,'/',admission_stage,'/',IFNULL(error_code,'-'))) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`),
  domAfterContinue: (await samples(page)).map((s) => `${s.t - tContinue}ms ${s.text.slice(0, 200)}`),
  errors,
});
await browser.close();
process.exit(0);
