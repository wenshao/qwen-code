// VERIFICATION RIG ONLY (PR #13107): what the panel does when the answer does not get through.
//   a) the service answers 503 once            -> card comes back, error shown, retry replays the same key
//   b) the answer is committed, the reply lost, delivery to the Harness is slow (8 s, injected at the tap)
//        -> card comes back; clicking the SAME option replays the operation
//   c) same, but the owner then clicks the OTHER option on the card that came back
// usage: DB=<db> node s4-faults.mjs [a|b|c ...]
import { ensureWorkspace, createSession, waitPending, waitTurn, readWs, executions, actionRow, finalText, sql, setTapRules, Report, sleep, j, written, assertIdle , WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, text, option } from './ui.mjs';

const which = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b', 'c', 'd', 'e'];
assertIdle();
const R = new Report('s4-faults');
ensureWorkspace(WS, `st-${ST}`);
const browser = await launch();
const RESPOND = '**/api/agent/web-shell/v1/actions/respond';
const alertText = async (page) => (await page.locator('p[role="alert"]').allInnerTexts()).join(' / ');
const ops = (S) => sql(`SELECT operation_id, state, idempotency_key, COALESCE(error_code,''), response_json FROM managed_agent_operation WHERE session_id='${S}' ORDER BY created_at`);

async function pendingSession(tag, content) {
  const file = `s4${tag}-${Date.now().toString(36)}.txt`;
  const c = await createSession('web', WS, `UI_WRITE name=${file} content=${content}`);
  const p = await waitPending(c.session, { surface: 'web' });
  const ui = await open(browser, { arm: 'head', session: c.session });
  const w = await waitCard(ui.page);
  R.check(`[${tag}] card shown`, w.ok, `session=${c.session} action=${p.action.actionId}`);
  return { S: c.session, A: p.action, ui, file };
}
const click = (ui, id) => option(ui.page, id).click();
const ALLOW = 'allow';
const DENY = 'deny';

if (which.includes('a')) {
  const { S, A, ui, file } = await pendingSession('a', 'after-503');
  let hits = 0;
  await ui.page.route(RESPOND, async (route) => {
    hits += 1;
    if (hits === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rig_unavailable', message: 'rig' } }) });
    return route.continue();
  });
  await click(ui, ALLOW);
  await sleep(1500);
  const back = (await card(ui.page).count()) === 1;
  R.check('[a] 503: the card comes back and the failure text is shown', back && /could not be confirmed/i.test(await alertText(ui.page)), `alert="${await alertText(ui.page)}"`);
  R.check('[a] 503: nothing was committed', actionRow(A.actionId)?.[0] === 'requested' && ops(S).length === 0, `state=${actionRow(A.actionId)?.[0]} operations=${ops(S).length}`);
  await shot(ui.page, 's4a-503-card-back');
  await click(ui, ALLOW);
  const g = await waitNoCard(ui.page);
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  await sleep(2000);
  const r = calls(ui.net, '/actions/respond');
  R.check('[a] retry succeeds with the same idempotency key', g.ok && r.length === 2 && r[0].req.idempotencyKey === r[1].req.idempotencyKey && r[1].status === 202, `keys=${j(r.map((e) => e.req.idempotencyKey))} statuses=${j(r.map((e) => e.status))}`);
  R.check('[a] Turn completes; file written once', t.status === 'COMPLETED' && readWs(ST, `child/${file}`) === written('after-503') && executions(S) === 1, `status=${t.status} executions=${executions(S)}`);
  R.check('[a] the failure text is gone after the successful retry', !/could not be confirmed/i.test(await alertText(ui.page)), `alert="${await alertText(ui.page)}"`);
  await ui.context.close();
}

if (which.includes('b')) {
  const { S, A, ui, file } = await pendingSession('b', 'after-lost-reply');
  setTapRules([{ match: 'POST .*/actions/.*/resolve', action: 'delay', delayMs: 8000 }]);
  let hits = 0;
  await ui.page.route(RESPOND, async (route) => {
    hits += 1;
    if (hits === 1) {
      await route.fetch(); // the service commits the answer ...
      return route.abort('connectionreset'); // ... and the browser never sees the reply
    }
    return route.continue();
  });
  await click(ui, ALLOW);
  await sleep(1200);
  const state1 = actionRow(A.actionId)?.[0];
  const backB = await card(ui.page).count();
  R.check('[b] lost reply while delivery is slow: the card comes back with the failure text', backB === 1 && /could not be confirmed/i.test(await alertText(ui.page)), `card=${backB} alert="${await alertText(ui.page)}" action=${state1} operations=${j(ops(S).map((o) => [o[1], o[2]]))}`);
  await shot(ui.page, 's4b-lost-reply');
  if (backB === 1) {
    await click(ui, ALLOW);
    await sleep(1500);
  }
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  await sleep(2000);
  const r = calls(ui.net, '/actions/respond');
  R.check('[b] one durable operation only, however many clicks', ops(S).length === 1 && ops(S)[0][1] === 'COMPLETED', j(ops(S).map((o) => [o[1], o[2], o[3]])));
  R.check('[b] Turn completes; the tool ran once', t.status === 'COMPLETED' && readWs(ST, `child/${file}`) === written('after-lost-reply') && executions(S) === 1, `status=${t.status} executions=${executions(S)}`);
  R.note('[b] respond calls seen by the page', j(r.map((e) => ({ status: e.status, failure: e.failure, key: e.req?.idempotencyKey, replayed: e.res?.replayed, code: e.res?.error?.code }))));
  R.note('[b] end state of the page', `card=${await card(ui.page).count()} alert="${await alertText(ui.page)}"`);
  setTapRules([]);
  await ui.context.close();
}

if (which.includes('c')) {
  const { S, A, ui, file } = await pendingSession('c', 'allowed-then-denied');
  setTapRules([{ match: 'POST .*/actions/.*/resolve', action: 'delay', delayMs: 8000 }]);
  let hits = 0;
  await ui.page.route(RESPOND, async (route) => {
    hits += 1;
    if (hits === 1) {
      await route.fetch();
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await click(ui, ALLOW); // committed by the service, reply lost
  await sleep(1500);
  const back = await card(ui.page).count();
  R.check('[c] lost "allow" reply while delivery is slow: the card comes back with the failure text', back === 1 && /could not be confirmed/i.test(await alertText(ui.page)), `card=${back} alert="${await alertText(ui.page)}" action=${actionRow(A.actionId)?.[0]} operations=${j(ops(S).map((o) => [o[1], o[2]]))}`);
  await shot(ui.page, 's4c-card-back-after-lost-allow');
  if (back === 1) {
    await click(ui, DENY); // the owner changes their mind on the card that came back
    await sleep(2500);
  }
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  await sleep(2000);
  const r = calls(ui.net, '/actions/respond');
  R.note('[c] respond calls seen by the page', j(r.map((e) => ({ status: e.status, failure: e.failure, option: e.req?.response?.optionId, key: e.req?.idempotencyKey, opStatus: e.res?.status, failureCode: e.res?.failureCode, code: e.res?.error?.code }))));
  R.note('[c] operations', j(ops(S).map((o) => [o[1], o[2], o[3]])));
  const content = readWs(ST, `child/${file}`);
  R.note('[c] outcome', `Turn=${t.status} file=${j(content)} executions=${executions(S)} final=${await finalText(S)}`);
  R.note('[c] end state of the page', `card=${await card(ui.page).count()} alert="${await alertText(ui.page)}"`);
  R.check('[c] the first committed answer wins (allow): the tool ran although the last click was "Reject"', content === written('allowed-then-denied'), `file=${j(content)}`);
  R.check('[c] the page never tells the owner that the second answer lost', (await card(ui.page).count()) === 0 && (await alertText(ui.page)) === '', `alert="${await alertText(ui.page)}"`);
  setTapRules([]);
  await shot(ui.page, 's4c-opposite-after-lost-reply');
  await ui.context.close();
}
for (const [tag, status, code] of [['d', 'failed', 'action_expired'], ['e', 'recovery_blocked', undefined]]) {
  if (!which.includes(tag)) continue;
  const { S, A, ui, file } = await pendingSession(tag, `after-${status}`);
  let hits = 0;
  await ui.page.route(RESPOND, async (route) => {
    hits += 1;
    if (hits > 1) return route.continue();
    // an HTTP 202 whose operation already ended without applying the answer
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ operationId: 'op_rig', sessionId: S, type: 'action_response', status, admissionStage: 'java_durable', deliveryState: 'blocked', replayed: false, ...(code ? { failureCode: code } : {}) }) });
  });
  await click(ui, ALLOW);
  await sleep(1500);
  R.check(`[${tag}] 202 with status ${status}: the card stays and the page says the answer could not be confirmed`, (await card(ui.page).count()) === 1 && /could not be confirmed/i.test(await alertText(ui.page)), `card=${await card(ui.page).count()} alert="${await alertText(ui.page)}"`);
  await shot(ui.page, `s4${tag}-202-${status}`);
  await click(ui, ALLOW);
  const g = await waitNoCard(ui.page);
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  await sleep(1500);
  const r = calls(ui.net, '/actions/respond');
  R.check(`[${tag}] retrying the same option reaches the service with the same key and the tool runs once`, g.ok && r.length === 2 && r[0].req.idempotencyKey === r[1].req.idempotencyKey && t.status === 'COMPLETED' && readWs(ST, `child/${file}`) === written(`after-${status}`) && executions(S) === 1, `keys=${j(r.map((e) => e.req.idempotencyKey))} statuses=${j(r.map((e) => e.status))} turn=${t.status} executions=${executions(S)}`);
  await ui.context.close();
}
await browser.close();
R.done();
process.exit(0);
