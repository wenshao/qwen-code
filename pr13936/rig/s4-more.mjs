// S4 known-operation reload | S5 natural completion | S6 background Shell + child (kind filter)
// usage: node s4-more.mjs <db> <S4|S5|S6>
import { chromium, openPage, startSampler, samples, createParent, driveTurn, api, sql, sleep, out, gw, release } from './lib.mjs';

const [db = 'db1', tag = 'S4'] = process.argv.slice(2);
const id = tag.toLowerCase() + Date.now().toString(36);
const R = (o) => out(`${tag}.jsonl`, { tag, ...o });
await gw('/nodelay');
const mode = tag === 'S6' ? 'mixsh' : 'bg';
const sid = await createParent(db, `PARENT::${mode}::${id}::hold start the background work`);
const launch = await driveTurn(db, sid);
let tasks = [];
for (let i = 0; i < 60; i++) {
  tasks = (await api(db, 'GET', `/${sid}/tasks`)).json?.data ?? [];
  if (tasks.some((x) => x.kind === 'child_agent' && x.state === 'running') && (mode !== 'mixsh' || tasks.length >= 2)) break;
  await sleep(1000);
}
const taskId = tasks.find((x) => x.kind === 'child_agent')?.id;
R({ step: 'launch', sid, launch, serverTasks: tasks.map((x) => `${x.kind}:${x.state}/${x.runtime_state}:${x.id.slice(0, 13)}`) });
const browser = await chromium.launch();
const { page, net, errors } = await openPage(browser, { sid });
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
const panel = page.locator('[data-managed-task-panel]');
await panel.getByRole('button', { name: /Child Agent · / }).first().waitFor({ timeout: 20000 });
await sleep(1500);

if (tag === 'S4') {
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await panel.getByText('State history').waitFor();
  await page.getByRole('button', { name: 'Request cancellation' }).click();
  const resp = page.waitForResponse((r) => r.url().endsWith('/tasks/cancel'));
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  const r = await resp;
  const admission = await r.json();
  const stored = await page.evaluate(() => Object.values(sessionStorage).join(''));
  const tReload = Date.now();
  await page.reload();
  const header = await page.getByText('Stop requested. Waiting for the task to end.').first().waitFor({ timeout: 15000 }).then(() => Date.now() - tReload, () => null);
  await page.screenshot({ path: `shots/${tag}-01-reloaded-header.png` });
  await page.getByRole('button', { name: 'Child Agent tasks' }).click();
  await page.waitForFunction(() => /Cancelled/.test(document.querySelector('[data-managed-task-panel]')?.innerText ?? ''), null, { timeout: 60000 }).catch(() => {});
  await sleep(1000);
  const after = net.filter((n) => n.t > tReload && n.kind === 'req' && (n.path === '/tasks/cancel' || n.path === '/operations/query'));
  R({
    step: 'result', sid, taskId, admission: `${admission.status}/${admission.admissionStage} ${admission.operationId}`,
    storedHasOperationId: stored.includes(admission.operationId),
    headerStopRequestedMsAfterReload: header,
    afterReload: after.map((n) => `${n.t - tReload}ms ${n.path} ${n.path === '/operations/query' ? JSON.parse(n.body).operationId : JSON.parse(n.body).idempotencyKey}`),
    cancelPostsAfterReload: after.filter((n) => n.path === '/tasks/cancel').length,
    finalPanel: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 200),
    dbOps: sql(db, `SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='TASK_CANCEL'`),
    errors,
  });
} else if (tag === 'S5') {
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await panel.getByText('State history').waitFor();
  await startSampler(page);
  const tRel = Date.now();
  R({ step: 'release', r: await release(id) });
  await page.waitForFunction(() => /Completed/.test(document.querySelector('[data-managed-task-panel]')?.innerText ?? ''), null, { timeout: 60000 }).catch(() => {});
  await sleep(3500);
  await page.screenshot({ path: `shots/${tag}-01-completed.png` });
  const text = (await panel.innerText()).replace(/\s+/g, ' ');
  R({
    step: 'result', sid, taskId,
    serverTask: (await api(db, 'GET', `/${sid}/tasks`)).json?.data?.map((x) => `${x.state} artifacts=${x.artifact_refs?.length} caps=${x.action_capabilities}`),
    cancelButtonVisible: await page.getByRole('button', { name: 'Request cancellation' }).count(),
    noArtifactsShown: text.includes('This task has not provided viewable Artifacts yet.'),
    panel: text.slice(0, 700),
    domTimeline: (await samples(page)).map((s) => `${s.t - tRel}ms ${s.text.slice(0, 160)}`).slice(0, 12),
    errors,
  });
} else {
  await sleep(2000);
  const text = (await panel.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: `shots/${tag}-01-filtered.png` });
  const pages = net.filter((n) => n.kind === 'res' && n.path === '/tasks/query').map((n) => { try { return JSON.parse(n.body).data.map((t) => t.kind).join(','); } catch { return '?'; } });
  R({
    step: 'result', sid,
    rawKindsInBrowserPages: [...new Set(pages)],
    rowsShown: await panel.getByRole('button', { name: /Child Agent · / }).count(),
    panel: text.slice(0, 400),
    errors,
  });
}
await browser.close();
process.exit(0);
