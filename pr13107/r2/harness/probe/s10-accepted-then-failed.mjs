// VERIFICATION RIG ONLY (PR #13107): the service accepts an answer (202, operation pending) and the operation
// later fails without deciding the Action. The tap answers the Harness resolve call with 400, so Java ends the
// operation as FAILED invalid_action_response while the Action stays requested.
// usage: DB=<db> node s10-accepted-then-failed.mjs
import { createSession, ensureWorkspace, waitPending, waitTurn, readWs, executions, actionRow, sql, setTapRules, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, option } from './ui.mjs';
assertIdle();
const R = new Report('s10-accepted-then-failed');
ensureWorkspace(WS, `st-${ST}`);
const alertText = async (page) => (await page.locator('[role="alert"]').allInnerTexts()).join(' / ');
const ops = (S) => sql(`SELECT state, idempotency_key, COALESCE(error_code,'') FROM managed_agent_operation WHERE session_id='${S}' ORDER BY created_at`);
const file = `s10-${Date.now().toString(36)}.txt`;
const c = await createSession('web', WS, `UI_WRITE name=${file} content=after-failed-operation`);
const S = c.session;
const p = await waitPending(S, { surface: 'web' });
setTapRules([{ match: 'POST .*/actions/.*/resolve', action: 'respond', status: 400, body: { code: 'invalid_action_response', message: 'rig' }, times: 50 }]);
const browser = await launch();
let ui = await open(browser, { arm: 'head', session: S });
await waitCard(ui.page);
await option(ui.page, 'allow').click();
await sleep(1500);
R.check('the answer is accepted: HTTP 202, operation pending', calls(ui.net, '/actions/respond')[0]?.status === 202 && calls(ui.net, '/actions/respond')[0]?.res?.status === 'pending', j(calls(ui.net, '/actions/respond')[0]?.res));
await sleep(12_000);
R.check('the operation then fails server-side and the Action is still requested', ops(S)[0]?.[0] === 'FAILED' && actionRow(p.action.actionId)?.[0] === 'requested', `operations=${j(ops(S))} action=${actionRow(p.action.actionId)?.[0]}`);
R.note('the page 13.5 s after the click', `card=${await card(ui.page).count()} alert="${await alertText(ui.page)}" actions/query=${calls(ui.net, '/actions/query').length}`);
await shot(ui.page, 's10-1-stranded');
await ui.context.close();
ui = await open(browser, { arm: 'head', session: S });
const back = await waitCard(ui.page);
R.check('after a reload the card is shown again', back.ok, '');
for (let i = 1; i <= 2; i += 1) {
  await option(ui.page, 'allow').click();
  await sleep(1500);
  const r = calls(ui.net, '/actions/respond').at(-1);
  R.note(`reloaded page, "Yes, allow once" #${i}`, `HTTP ${r?.status} status=${r?.res?.status} failureCode=${r?.res?.failureCode} replayed=${r?.res?.replayed} card=${await card(ui.page).count()} alert="${await alertText(ui.page)}"`);
}
await shot(ui.page, 's10-2-replay-loop');
setTapRules([]);
await option(ui.page, 'allow').click();
await sleep(2000);
R.note('same option again after the Harness recovers', `HTTP ${calls(ui.net, '/actions/respond').at(-1)?.res?.status} card=${await card(ui.page).count()}`);
R.check('retrying the same option can never apply the answer (the key replays the FAILED operation)', ops(S).length === 1 && actionRow(p.action.actionId)?.[0] === 'requested', `operations=${j(ops(S))}`);
await option(ui.page, 'deny').click();
const g = await waitNoCard(ui.page);
const t = await waitTurn(S, { timeoutMs: 60_000 });
R.check('only the other option (a new key) gets through', g.ok && t.status === 'COMPLETED' && readWs(ST, `child/${file}`) === null && executions(S) === 0, `turn=${t.status} operations=${j(ops(S))}`);
await browser.close();
R.done({ session: S });
process.exit(0);
