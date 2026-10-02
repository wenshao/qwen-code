// VERIFICATION RIG ONLY (PR #13165): a reader (bob) looks at the creator's (alice's) Session in the real
// Managed panel and tries to answer its approvals. The 403 comes from the real Java service
// (ManagedActionStore.requireOwner), the next approval of the same Session arrives through the real event
// stream after alice answers the first one, and bob then switches to a Session he created himself.
// Expectations are per arm: "head" must show the PR's behaviour, "base" must reproduce the bug it fixes.
// usage: DB=<db> node s1-forbidden.mjs <head|base> [lang]
import { api, ensureWorkspace, register, createSession, listActions, waitPending, waitTurn, readWs, executions, actionRow, Report, sleep, j, one, written, sql, TENANT, respond as apiRespond } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, text, option } from './ui.mjs';

const [arm = 'head', lang = 'en'] = process.argv.slice(2);
const HEAD = arm === 'head';
const R = new Report(`s1-forbidden-${arm}${lang === 'en' ? '' : '-' + lang}`);
const FORBIDDEN = lang === 'zh' ? '只有此会话的创建者可以回答这项审批。' : 'Only the Session creator can answer this approval.';
for (const [ws, st, creators, readers] of [
  ['ws-a', 'st-a', ['alice', 'carol'], ['bob']],
  ['ws-b', 'st-b', ['bob', 'alice'], []],
]) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`) === '0') register(ws, st, { creators, readers });
}
const idle = (ws) => sql(`SELECT t.session_id FROM managed_agent_turn t JOIN managed_agent_session s ON s.session_id = t.session_id WHERE s.workspace_id = '${ws}' AND t.status NOT IN ('COMPLETED','FAILED','CANCELLED')`).length === 0;
if (!idle('ws-a') || !idle('ws-b')) { console.error('RIG BUSY'); process.exit(2); }

const tag = `${arm}-${Date.now().toString(36)}`;
// Option state as the user agent sees it: disabled attribute, computed opacity and cursor.
async function optionState(page) {
  return card(page).locator('[data-option-id]').evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return { id: el.getAttribute('data-option-id'), disabled: el.disabled, opacity: s.opacity, cursor: s.cursor };
    }),
  );
}
// The reason line, its role, and whether the alertdialog points at it.
async function notice(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="managed-approval"] [role="alertdialog"]') ?? document.querySelector('[role="alertdialog"]');
    const ids = (dialog?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const lines = [...document.querySelectorAll('p.text-destructive[role="alert"], p.text-destructive[role="status"]')].map((p) => ({ role: p.getAttribute('role'), id: p.id, text: p.textContent.trim(), referenced: ids.includes(p.id) }));
    const dangling = ids.filter((id) => !document.getElementById(id));
    const active = document.activeElement;
    return { lines, describedby: ids, dangling, active: active ? `${active.tagName.toLowerCase()}${active.getAttribute('data-option-id') ? `[option=${active.getAttribute('data-option-id')}]` : ''}${active === document.body ? '(body)' : ''}` : null };
  });
}
// A real pointer click at the option's centre, even when the button is disabled (Playwright's click() would wait).
async function pointerClick(page, id) {
  const box = await option(page, id).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const responds = (net, session) => calls(net, '/actions/respond').filter((e) => e.req?.sessionId === session);
async function waitResponds(net, session, n, timeoutMs = 10_000) {
  const start = Date.now();
  while (responds(net, session).length < n && Date.now() - start < timeoutMs) await sleep(100);
  return responds(net, session);
}
async function select(page, session) {
  await page.evaluate((s) => window.__rig.select(s), session);
}

const browser = await launch();
// ── Session A: alice's, two approvals in a row. bob (read-only on ws-a) watches it.
const A = await createSession('web', 'ws-a', `UI_SEQ n=2 name=fa-${tag} delay=6000`, { actor: 'alice' });
R.check('alice creates Session A in ws-a (two write_file approvals in a row)', A.status === 202, `HTTP ${A.status} session=${A.session}`);
const ui = await open(browser, { arm, actor: 'bob', lang, session: A.session });
const w1 = await waitCard(ui.page, { timeoutMs: 45_000 });
R.check('bob (reader) sees the first approval card of Session A via the stream', w1.ok, `after ${w1.ms} ms`);
await sleep(500);
const a1 = (await listActions('web', A.session, { actor: 'alice' })).json.data?.find((a) => a.state === 'requested');
R.note('Action A1', j({ id: a1?.actionId, tool: a1?.toolName }));
const before = await optionState(ui.page);
R.check('before any answer: every option is enabled', before.length >= 2 && before.every((o) => !o.disabled), j(before));

// First click: the real service refuses it.
await option(ui.page, 'allow').click();
const r1 = await waitResponds(ui.net, A.session, 1);
await sleep(1200);
R.check('first click sends one actions/respond and the real service answers 403 action_forbidden', r1.length === 1 && r1[0].status === 403 && r1[0].res?.error?.code === 'action_forbidden', j({ status: r1[0]?.status, body: r1[0]?.res }));
const afterFirst = await optionState(ui.page);
const n1 = await notice(ui.page);
await shot(ui.page, `s1-${arm}-${lang}-1-after-403`);
R.note('options after the 403', j(afterFirst));
R.note('reason line / aria after the 403', j(n1));
if (HEAD) {
  R.check('head: every option is disabled after the 403', afterFirst.length >= 2 && afterFirst.every((o) => o.disabled), j(afterFirst.map((o) => o.disabled)));
  R.check('head: disabled options are dimmed (opacity 0.5, cursor not-allowed)', afterFirst.every((o) => o.opacity === '0.5' && o.cursor === 'not-allowed'), j(afterFirst));
} else {
  R.check('base reproduces: options stay enabled after the 403', afterFirst.every((o) => !o.disabled), j(afterFirst.map((o) => o.disabled)));
}
const alert1 = n1.lines.find((l) => l.text === FORBIDDEN);
R.check('the creator-only reason is shown as role=alert', alert1?.role === 'alert', j(n1.lines));
R.check(HEAD ? 'head: the alertdialog references the reason line (aria-describedby), no dangling IDREF' : 'base: the reason line is not referenced by the dialog', HEAD ? alert1?.referenced === true && n1.dangling.length === 0 : alert1?.referenced !== true, j({ describedby: n1.describedby, dangling: n1.dangling }));
R.note('focus after the 403', n1.active);

// Further attempts: two pointer clicks and the keyboard.
await pointerClick(ui.page, 'allow');
await sleep(1500);
await pointerClick(ui.page, 'deny').catch(() => {});
await sleep(1500);
await card(ui.page).locator('[role="alertdialog"]').first().focus().catch(() => {});
for (const key of ['1', 'Enter', 'Space']) await ui.page.keyboard.press(key);
await sleep(1500);
const r2 = responds(ui.net, A.session);
if (HEAD) {
  R.check('head: two more clicks and 1/Enter/Space send no further request (respond stays at 1)', r2.length === 1, `respond calls=${r2.length} ${j(r2.map((e) => e.status))}`);
} else {
  R.check('base reproduces: each further click sends another request the service refuses', r2.length >= 3 && r2.slice(1).every((e) => e.status === 403), `respond calls=${r2.length} ${j(r2.map((e) => e.status))}`);
}
const forbiddenRows = () => Number(one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${A.session}' AND operation_kind='ACTION_RESPONSE'`));
R.check('no action_response operation was admitted for bob (the 403 is decided before admission)', forbiddenRows() === 0, `ACTION_RESPONSE operations=${forbiddenRows()}`);
R.check('A1 is still requested in the database', actionRow(a1.actionId)?.[0] === 'requested', j(actionRow(a1.actionId)));

// ── alice answers A1 through the API; the Turn goes on and raises A2 in the same Session.
const ans1 = await apiRespond('web', A.session, a1, 'allow', { actor: 'alice', key: `alice-${a1.actionId}` });
R.check('alice (creator) answers A1 through the WebShell adapter: 202', ans1.status === 202, `HTTP ${ans1.status}`);
const p2 = await waitPending(A.session, { surface: 'web', actor: 'alice', not: [a1.actionId], timeoutMs: 60_000 });
R.check('the Turn continues and raises A2 in Session A', !p2.timeout, `after ${p2.ms} ms id=${p2.action?.actionId}`);
const a2 = p2.action;
// Wait until bob's card is the new Action (A1 leaves, A2 arrives through the stream).
const start2 = Date.now();
let cardTitle;
for (;;) {
  const ids = await ui.page.evaluate(() => [...document.querySelectorAll('[data-testid="managed-approval"]')].map((e) => e.textContent));
  cardTitle = ids.join('|');
  const q = calls(ui.net, '/actions/query').at(-1);
  if (q?.res?.data?.some((x) => x.actionId === a2.actionId) && (await card(ui.page).count())) break;
  if (Date.now() - start2 > 30_000) break;
  await sleep(200);
}
await sleep(1500);
const afterSecond = await optionState(ui.page);
const n2 = await notice(ui.page);
await shot(ui.page, `s1-${arm}-${lang}-2-next-approval`);
R.check('bob\'s page now shows the A2 card', (await card(ui.page).count()) === 1 && Date.now() - start2 < 30_000, `after ${Date.now() - start2} ms`);
R.note('A2 options', j(afterSecond));
R.note('A2 reason line / aria', j(n2));
const status2 = n2.lines.find((l) => l.text === FORBIDDEN);
if (HEAD) {
  R.check('head: A2 arrives already disabled', afterSecond.length >= 2 && afterSecond.every((o) => o.disabled), j(afterSecond.map((o) => o.disabled)));
  R.check('head: the reason stays on screen for A2 as role=status (not a second alert), referenced by the dialog', status2?.role === 'status' && status2.referenced && n2.lines.filter((l) => l.role === 'alert').length === 0 && n2.dangling.length === 0, j(n2.lines));
} else {
  R.check('base reproduces: A2 arrives enabled with no reason on screen', afterSecond.every((o) => !o.disabled) && !status2, j({ options: afterSecond.map((o) => o.disabled), lines: n2.lines }));
}
const beforeA2 = responds(ui.net, A.session).length;
await pointerClick(ui.page, 'allow');
await sleep(2000);
const r3 = responds(ui.net, A.session).slice(beforeA2);
if (HEAD) R.check('head: clicking A2 sends nothing', r3.length === 0, `new respond calls=${r3.length}`);
else R.check('base reproduces: clicking A2 sends another refused request', r3.length === 1 && r3[0].status === 403, j(r3.map((e) => ({ status: e.status, code: e.res?.error?.code }))));
await shot(ui.page, `s1-${arm}-${lang}-3-after-click-a2`);

// ── bob switches to a Session he created himself (ws-b) with its own pending approval.
const B = await createSession('web', 'ws-b', `UI_WRITE name=fb-${tag}.txt content=bob-owns-this delay=3000`, { actor: 'bob' });
R.check('bob creates Session B in ws-b (bob is a creator there)', B.status === 202, `HTTP ${B.status} session=${B.session}`);
const pb = await waitPending(B.session, { surface: 'web', actor: 'bob', timeoutMs: 45_000 });
R.check('Session B raises its approval', !pb.timeout, `after ${pb.ms} ms`);
await select(ui.page, B.session);
const wb = await waitCard(ui.page, { timeoutMs: 20_000 });
await sleep(1200);
const bState = await optionState(ui.page);
const nb = await notice(ui.page);
await shot(ui.page, `s1-${arm}-${lang}-4-own-session`);
R.check('the latch does not follow bob to Session B: card enabled, no reason line', wb.ok && bState.every((o) => !o.disabled) && nb.lines.length === 0, j({ ok: wb.ok, options: bState.map((o) => o.disabled), lines: nb.lines }));
await option(ui.page, 'allow').click();
const rb = await waitResponds(ui.net, B.session, 1);
R.check('bob answers his own Session B: 202', rb[0]?.status === 202, j({ status: rb[0]?.status, body: rb[0]?.res }));
const tb = await waitTurn(B.session, { timeoutMs: 60_000 });
R.check('Session B Turn completes and the file is written', tb.status === 'COMPLETED' && readWs('b', `child/fb-${tag}.txt`) === written('bob-owns-this'), `turn=${tb.status} file=${j(readWs('b', `child/fb-${tag}.txt`))}`);

// ── back to Session A: A2 is still pending.
await select(ui.page, A.session);
const wa = await waitCard(ui.page, { timeoutMs: 20_000 });
await sleep(1500);
const backState = await optionState(ui.page);
const nback = await notice(ui.page);
await shot(ui.page, `s1-${arm}-${lang}-5-back-to-a`);
if (HEAD) R.check('head: back on Session A, A2 is still disabled with the reason as role=status', wa.ok && backState.every((o) => o.disabled) && nback.lines.some((l) => l.role === 'status' && l.text === FORBIDDEN), j({ options: backState.map((o) => o.disabled), lines: nback.lines }));
else R.check('base: back on Session A, A2 is enabled again', wa.ok && backState.every((o) => !o.disabled), j({ options: backState.map((o) => o.disabled), lines: nback.lines }));
const beforeBack = responds(ui.net, A.session).length;
await pointerClick(ui.page, 'allow');
await sleep(2000);
const r4 = responds(ui.net, A.session).slice(beforeBack);
if (HEAD) R.check('head: clicking after coming back sends nothing', r4.length === 0, `new respond calls=${r4.length}`);
else R.check('base reproduces: clicking after coming back sends another refused request', r4.length === 1 && r4[0].status === 403, j(r4.map((e) => e.status)));

// ── alice answers A2; the Turn completes; bob's card and reason leave.
const ans2 = await apiRespond('web', A.session, a2, 'allow', { actor: 'alice', key: `alice-${a2.actionId}` });
R.check('alice answers A2: 202', ans2.status === 202, `HTTP ${ans2.status}`);
const ta = await waitTurn(A.session, { timeoutMs: 60_000 });
R.check('Session A Turn completes, both files written by alice\'s answers', ta.status === 'COMPLETED' && executions(A.session) === 2, `turn=${ta.status} executions=${executions(A.session)}`);
const gone = await waitNoCard(ui.page, { timeoutMs: 20_000 });
await sleep(1500);
const nend = await notice(ui.page);
R.check('the card leaves bob\'s page and no reason line is left behind', gone.ok && nend.lines.length === 0, j(nend.lines));
await shot(ui.page, `s1-${arm}-${lang}-6-done`);
const allResponds = responds(ui.net, A.session);
R.note('bob\'s actions/respond calls on Session A (status list)', j(allResponds.map((e) => e.status)));
R.note('browser console errors', j(ui.consoleErrors));
R.check('no uncaught page errors', !ui.consoleErrors.some((e) => e.startsWith('pageerror')), j(ui.consoleErrors));
await browser.close();
R.done({ A: A.session, B: B.session, a1: a1.actionId, a2: a2.actionId, respondsOnA: allResponds.map((e) => e.status) });
process.exit(0);
