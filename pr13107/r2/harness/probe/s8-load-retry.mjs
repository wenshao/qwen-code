// VERIFICATION RIG ONLY (PR #13107): the pending-approval read fails when the page opens.
//   a) one 503  -> the page retries by itself and the card appears
//   b) four 503 -> retries stop after 2 s, 5 s and 10 s; the Retry button brings the card
// usage: DB=<db> node s8-load-retry.mjs
import { createSession, ensureWorkspace, waitPending, waitTurn, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, option } from './ui.mjs';
assertIdle();
const R = new Report('s8-load-retry');
ensureWorkspace(WS, `st-${ST}`);
const QUERY = '**/api/agent/web-shell/v1/actions/query';
const alerts = async (page) => (await page.locator('[role="alert"]').allInnerTexts()).join(' / ');
const browser = await launch();
for (const [tag, failures] of [['a', 1], ['b', 4]]) {
  const c = await createSession('web', WS, `UI_WRITE name=s8${tag}-${Date.now().toString(36)}.txt content=after-read-failure`);
  await waitPending(c.session, { surface: 'web' });
  let hits = 0;
  // open the page first, install the failing route, then select the Session so its first read fails
  const ui2 = await (async () => {
    const o = await open(browser, { arm: 'head' });
    await o.page.route(QUERY, async (route) => {
      hits += 1;
      if (hits <= failures) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rig_unavailable', message: 'rig' } }) });
      return route.continue();
    });
    await o.page.evaluate((s) => window.__rig.select(s), c.session);
    return o;
  })();
  const t0 = Date.now();
  await ui2.page.locator('[role="alert"]', { hasText: 'Pending approvals could not be loaded' }).waitFor({ timeout: 15_000 });
  R.check(`[${tag}] ${failures} failed read(s): the page says pending approvals could not be loaded`, true, `after ${Date.now() - t0} ms; alert="${await alerts(ui2.page)}"`);
  if (tag === 'a') {
    const w = await waitCard(ui2.page, { timeoutMs: 8_000 });
    R.check('[a] the page retries by itself and the card appears', w.ok, `card ${Date.now() - t0} ms after selecting; queries=${calls(ui2.net, '/actions/query').length} (1 failed)`);
    R.check('[a] the load error is gone once the read succeeds', !/could not be loaded/.test(await alerts(ui2.page)), `alert="${await alerts(ui2.page)}"`);
  } else {
    await shot(ui2.page, 's8b-load-failed');
    await sleep(22_000);
    const q = calls(ui2.net, '/actions/query');
    const times = q.map((e) => e.t - t0);
    R.check('[b] retries are bounded: 1 read + 3 retries, then none', q.length === 4 && (await card(ui2.page).count()) === 0, `reads at ${j(times)} ms; statuses ${j(q.map((e) => e.status))}`);
    R.check('[b] the Retry button is offered', (await ui2.page.getByRole('button', { name: 'Retry loading approvals' }).count()) === 1, '');
    await ui2.page.getByRole('button', { name: 'Retry loading approvals' }).click();
    const w = await waitCard(ui2.page, { timeoutMs: 8_000 });
    R.check('[b] Retry reads again and the card appears', w.ok && !/could not be loaded/.test(await alerts(ui2.page)), `${w.ms} ms; reads=${calls(ui2.net, '/actions/query').length}`);
  }
  await option(ui2.page, 'deny').click();
  await waitNoCard(ui2.page);
  const t = await waitTurn(c.session);
  R.check(`[${tag}] the answer from the recovered card completes the Turn`, t.status === 'COMPLETED', t.status);
  await ui2.context.close();
}
await browser.close();
R.done();
process.exit(0);
