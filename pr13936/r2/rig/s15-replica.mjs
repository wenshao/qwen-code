// S15: stale replica. The gateway delays every task list/detail reply that carries no terminal state
// by <ms>, while terminal replies pass at once. So a read the panel issued before settlement lands
// after the cancel reader has already seen the terminal task. Verdict: once the panel shows
// Cancelled it must never go back to Running or offer "Request cancellation" again.
// usage: ARM=merge|cand node s15-replica.mjs <db> <tag> <list|detail> [ms=4000]
import { chromium, openPage, startSampler, samples, launchChild, api, sql, sleep, out, gw } from './lib.mjs';

const [db = 'db1', tag = 'S15', view = 'detail', ms = '4000', msGet = ms] = process.argv.slice(2);
const R = (o) => out(`${tag}.jsonl`, { tag, arm: process.env.ARM ?? 'merge', view, ms: Number(ms), msGet: Number(msGet), ...o });
await gw('/nodelay');
const { sid, taskId, launch } = await launchChild(db, 'rp');
R({ step: 'launch', sid, taskId, launch });
if (!taskId) process.exit(1);
const browser = await chromium.launch();
const { page, net, errors } = await openPage(browser, { sid, arm: process.env.ARM ?? 'merge' });
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
const panel = page.locator('[data-managed-task-panel]');
if (view === 'detail') {
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await panel.getByText('State history').waitFor();
}
await sleep(1500);
await gw(`/stale?path=/tasks/query&ms=${ms}`);
if (Number(msGet)) await gw(`/stale?path=/tasks/get&ms=${msGet}`);
await startSampler(page);
await page.getByRole('button', { name: 'Request cancellation' }).click();
const tClick = Date.now();
await page.getByRole('button', { name: 'Confirm cancellation' }).click();
// server truth: public task API (not through the gateway) polled every 100 ms
let serverCancelledAt = null;
for (let i = 0; i < 600 && !serverCancelledAt; i++) {
  const t = await api(db, 'GET', `/${sid}/tasks`);
  if (t.json?.data?.find((x) => x.id === taskId)?.state === 'cancelled') serverCancelledAt = Date.now();
  else await sleep(100);
}
const firstCancelled = await panel.getByText('Cancelled', { exact: true }).first().waitFor({ timeout: 30000 }).then(() => Date.now(), () => null);
// watch for a regression for ms + 7 s (covers the in-flight stale reply and two more polls)
const regress = await page.getByRole('button', { name: 'Request cancellation' }).waitFor({ timeout: Number(ms) + 7000 }).then(() => Date.now(), () => null);
let regressShot = null;
if (regress) {
  regressShot = `shots/${tag}-01-regressed.png`;
  await page.screenshot({ path: regressShot });
  await page.getByRole('button', { name: 'Request cancellation' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click({ timeout: 3000 }).catch((e) => R({ step: 'confirm-click-failed', e: String(e).slice(0, 160) }));
  await sleep(4000);
} else await sleep(1000);
await page.screenshot({ path: `shots/${tag}-02-settled.png` });
const smp = await samples(page);
// after navigation: back to list and re-open detail, still with the stale replica on
let afterNav = null;
if (view === 'detail') {
  await panel.getByRole('button', { name: 'Back to tasks' }).click();
  await sleep(500);
  const listText = (await panel.innerText()).replace(/\s+/g, ' ');
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await sleep(Number(ms) + 4000);
  afterNav = { listText: listText.slice(0, 200), detailText: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 300) };
}
await gw('/nodelay');
const tCancelledSample = smp.find((s) => /Cancelled/.test(s.text.split('|| HEADER')[0]))?.t;
const after = tCancelledSample ? smp.filter((s) => s.t > tCancelledSample) : [];
const panelPart = (s) => s.text.split('|| HEADER')[0];
const lostCancelled = after.filter((s) => !/Cancelled/.test(panelPart(s)));
const offered = after.filter((s) => /Request cancellation/.test(panelPart(s)));
const failedText = smp.filter((s) => /Cancellation request failed/.test(s.text));
const posts = net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel').length;
// every task snapshot the page received (list + detail), with its delivery time and the task state
const deliveries = net.filter((n) => n.kind === 'res' && (n.path === '/tasks/query' || n.path === '/tasks/get') && n.t > tClick)
  .map((n) => ({ path: n.path, ms: n.t - tClick, state: (/"state":"([a-z_]+)"/.exec(n.body) ?? [])[1] }));
const staleAfterCancelled = tCancelledSample ? deliveries.filter((d) => d.ms > tCancelledSample - tClick && d.state !== 'cancelled') : [];
const cancelRes = net.filter((n) => n.kind === 'res' && n.path === '/tasks/cancel').map((n) => n.status);
R({
  step: 'result', sid, taskId,
  serverCancelledMs: serverCancelledAt && serverCancelledAt - tClick,
  uiCancelledMs: tCancelledSample && tCancelledSample - tClick,
  regressionAfterCancelled: lostCancelled.length, offeredAfterCancelled: offered.length,
  regressionFirstMs: lostCancelled[0] ? lostCancelled[0].t - tClick : null,
  regressionSample: lostCancelled[0] ? panelPart(lostCancelled[0]).slice(0, 220) : null,
  buttonBackMs: regress && regress - tClick,
  failedTextSamples: failedText.length,
  staleDeliveredAfterCancelled: staleAfterCancelled, deliveries: deliveries.map((d) => `${d.ms} ${d.path.slice(7)} ${d.state}`),
  cancelPosts: posts, cancelResponses: cancelRes,
  finalPanel: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 300),
  afterNav,
  dbOps: sql(db, `SELECT GROUP_CONCAT(CONCAT(state,'/',IFNULL(error_code,'-'))) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`),
  errors,
});
await browser.close();
process.exit(0);
