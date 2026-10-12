// S1: real child Agent cancelled from the panel; admission vs settlement; draft + parent continuation.
// usage: node s1-cancel.mjs <db> [tag]
import { chromium, openPage, startSampler, samples, createParent, driveTurn, api, sql, sleep, out, gwLog } from './lib.mjs';

const db = process.argv[2] ?? 'db1';
const tag = process.argv[3] ?? 'S1';
const id = 'c' + Date.now().toString(36);
const token = 'tk' + id;
const R = (o) => out(`${tag}.jsonl`, { tag, ...o });

const sid = await createParent(db, `PARENT::bg::${id}::hold start the background child`);
const launch = await driveTurn(db, sid);
let taskId;
for (let i = 0; i < 60 && !taskId; i++) {
  const t = await api(db, 'GET', `/${sid}/tasks`);
  const row = t.json?.data?.find((x) => x.kind === 'child_agent' && x.state === 'running');
  if (row) taskId = row.id;
  else await sleep(1000);
}
R({ step: 'launch', sid, id, launch, taskId });
if (!taskId) process.exit(3);

const browser = await chromium.launch();
const { page, net, errors } = await openPage(browser, { sid, arm: process.env.ARM ?? 'merge' });
const entry = page.getByRole('button', { name: 'Child Agent tasks' });
await entry.waitFor({ timeout: 30000 });
const composer = page.getByPlaceholder('Message the managed agent');
await composer.fill(`CONT::${token}`);
await entry.click();
const row = page.locator('[data-managed-task-panel]').getByRole('button', { name: /Child Agent · / });
await row.first().waitFor({ timeout: 20000 });
await page.locator('[data-managed-task-panel]').getByText('Running').first().waitFor({ timeout: 20000 });
await page.screenshot({ path: `shots/${tag}-01-list.png` });
await row.first().click();
await page.getByText('State history').waitFor();
await page.locator('[data-managed-task-panel]').getByText('Ready').first().waitFor({ timeout: 15000 }).catch(() => {});
await sleep(1500);
await page.screenshot({ path: `shots/${tag}-02-detail.png` });

// server truth poller (public API, independent of the page)
const truth = [];
let polling = true;
(async () => {
  let last = '';
  while (polling) {
    const t = await api(db, 'GET', `/${sid}/tasks`);
    const r = t.json?.data?.find((x) => x.id === taskId);
    const s = r ? `${r.state}/${r.runtime_state ?? '-'}` : `missing ${t.status}`;
    if (s !== last) { truth.push({ t: Date.now(), s }); last = s; }
    await sleep(100);
  }
})();

await startSampler(page);
await page.getByRole('button', { name: 'Request cancellation' }).click();
await page.getByRole('button', { name: 'Confirm cancellation' }).waitFor();
await page.screenshot({ path: `shots/${tag}-03-confirm.png` });
const tClick = Date.now();
await page.getByRole('button', { name: 'Confirm cancellation' }).click();
const stop = page.getByText('Stop requested. Waiting for the task to end.').first();
const sawStop = await stop.waitFor({ timeout: 15000 }).then(() => Date.now(), () => null);
if (sawStop) await page.screenshot({ path: `shots/${tag}-04-stop-requested.png` });
const badge = page.locator('[data-managed-task-panel] .break-all.font-medium + *');
const settled = await page.waitForFunction(
  () => /Cancelled/.test(document.querySelector('[data-managed-task-panel]')?.innerText ?? ''),
  null,
  { timeout: 90000 },
).then(() => Date.now(), () => null);
await sleep(3500);
await page.screenshot({ path: `shots/${tag}-05-settled.png` });
polling = false;
const smp = await samples(page);

// draft survived? then send it as the next parent Turn
const draft = await composer.inputValue();
const turnsBefore = Number(sql(db, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}'`));
await page.getByRole('button', { name: 'Send' }).click();
let cont = null;
for (let i = 0; i < 40; i++) {
  const n = Number(sql(db, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}'`));
  if (n > turnsBefore) { cont = await driveTurn(db, sid, 120000); break; }
  await sleep(500);
}
const reversed = [...token].reverse().join('');
const replyShown = await page.getByText(`PARENT_CONTINUATION_OK::${reversed}`).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
await page.screenshot({ path: `shots/${tag}-06-continued.png` });

// evidence
const posts = net.filter((n) => n.kind === 'req' && n.path === '/tasks/cancel');
const opRes = net.filter((n) => n.kind === 'res' && (n.path === '/tasks/cancel' || n.path === '/operations/query'))
  .map((n) => { try { const j = JSON.parse(n.body); return { t: n.t - tClick, path: n.path, http: n.status, status: j.status, stage: j.admissionStage, delivery: j.deliveryState, op: j.operationId, receipt: !!j.receiptId, replayed: j.replayed }; } catch { return { t: n.t - tClick, path: n.path, http: n.status, body: n.body.slice(0, 200) }; } });
const taskGets = net.filter((n) => n.kind === 'res' && n.path === '/tasks/get' && n.t >= tClick)
  .map((n) => { try { const j = JSON.parse(n.body); return `${n.t - tClick}ms ${j.state}/${j.runtimeState ?? '-'}`; } catch { return 'x'; } });
const firstDomCancelled = smp.find((s) => /Cancelled/.test(s.text.split(' || HEADER:')[0]));
const firstTruthCancelled = truth.find((x) => x.s.startsWith('cancelled'));
const lastTurn = sql(db, `SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at DESC LIMIT 1`);
const childTurn = sql(db, `SELECT GROUP_CONCAT(CONCAT(t.status,' ',IFNULL(t.error_code,'-'))) FROM managed_agent_turn t JOIN managed_agent_session s ON s.tenant_id=t.tenant_id AND s.session_id=t.session_id WHERE s.parent_session_id='${sid}'`);
const opsInDb = sql(db, `SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`).trim();
R({
  step: 'result', sid, taskId,
  cancelPosts: posts.length, cancelKeys: posts.map((p) => JSON.parse(p.body).idempotencyKey),
  operationResponses: opRes,
  taskGetsAfterClick: taskGets,
  sawStopRequestedMs: sawStop && sawStop - tClick,
  domCancelledMs: firstDomCancelled ? firstDomCancelled.t - tClick : null,
  serverCancelledMs: firstTruthCancelled ? firstTruthCancelled.t - tClick : null,
  domBeforeServer: firstDomCancelled && firstTruthCancelled ? firstDomCancelled.t < firstTruthCancelled.t : null,
  truth: truth.map((x) => `${x.t - tClick}ms ${x.s}`),
  domStates: smp.map((s) => `${s.t - tClick}ms ${s.text.slice(0, 260)}`),
  draftAfterCancel: draft, continuation: cont, replyShown, parentLastTurn: lastTurn, childTurns: childTurn, taskCancelOpsInDb: opsInDb,
  errors,
});
await browser.close();
process.exit(0);
