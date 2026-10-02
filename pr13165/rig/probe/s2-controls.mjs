// VERIFICATION RIG ONLY (PR #13165): the controls around the creator-only latch, on the real stack.
//   part 1  a coded retryable failure (503) on the creator's own answer leaves the card answerable
//           (the 503 is injected at the browser's network layer; the retry goes to the real service)
//   part 2  the real 403 lands after the refused Action already left the list (the request is held in the
//           browser while the creator answers and the Turn raises the next approval)
//   part 3  the latch is per mount: a reload starts clean and costs exactly one more refused request
// usage: DB=<db> node s2-controls.mjs <head|base> [lang] [parts=123]
import { createSession, listActions, waitPending, waitTurn, readWs, executions, actionRow, Report, sleep, j, one, written, sql, TENANT, register, respond as apiRespond } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, option } from './ui.mjs';

const [arm = 'head', lang = 'en', parts = '123'] = process.argv.slice(2);
const HEAD = arm === 'head';
const R = new Report(`s2-controls-${arm}${lang === 'en' ? '' : '-' + lang}`);
const FORBIDDEN = lang === 'zh' ? '只有此会话的创建者可以回答这项审批。' : 'Only the Session creator can answer this approval.';
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='ws-a'`) === '0') register('ws-a', 'st-a', { creators: ['alice', 'carol'], readers: ['bob'] });
const idle = () => sql(`SELECT t.session_id FROM managed_agent_turn t JOIN managed_agent_session s ON s.session_id = t.session_id WHERE s.workspace_id = 'ws-a' AND t.status NOT IN ('COMPLETED','FAILED','CANCELLED')`).length === 0;
if (!idle()) { console.error('RIG BUSY'); process.exit(2); }
const tag = `${arm}-${Date.now().toString(36)}`;

async function optionState(page) {
  return card(page).locator('[data-option-id]').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-option-id'), disabled: el.disabled })));
}
async function notice(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    const ids = (dialog?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return [...document.querySelectorAll('p.text-destructive[role="alert"], p.text-destructive[role="status"]')].map((p) => ({ role: p.getAttribute('role'), text: p.textContent.trim(), referenced: ids.includes(p.id) }));
  });
}
async function pointerClick(page, id) {
  const box = await option(page, id).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const responds = (net, s) => calls(net, '/actions/respond').filter((e) => e.req?.sessionId === s);
async function waitResponds(net, s, n, timeoutMs = 10_000) {
  const t = Date.now();
  while (responds(net, s).length < n && Date.now() - t < timeoutMs) await sleep(100);
  return responds(net, s);
}
const browser = await launch();

if (parts.includes('1')) {
  // ── part 1: the creator's own answer fails once with a coded 503, then goes through.
  const C = await createSession('web', 'ws-a', `UI_WRITE name=fc-${tag}.txt content=retry-after-503 delay=6000`, { actor: 'alice' });
  R.check('p1: alice creates Session C', C.status === 202, `session=${C.session}`);
  const ui = await open(browser, { arm, actor: 'alice', lang, session: C.session });
  let injected = 0;
  await ui.page.route('**/api/agent/web-shell/v1/actions/respond', async (route) => {
    if (injected++ === 0) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Busy', request_id: 'rig-injected' } }) });
    return route.continue();
  });
  const w = await waitCard(ui.page, { timeoutMs: 45_000 });
  R.check('p1: the approval card appears', w.ok, `after ${w.ms} ms`);
  await sleep(500);
  await option(ui.page, 'allow').click();
  await waitResponds(ui.net, C.session, 1);
  await sleep(1200);
  const st = await optionState(ui.page);
  const n = await notice(ui.page);
  await shot(ui.page, `s2-${arm}-${lang}-p1-after-503`);
  R.check('p1: after the coded 503 every option is still enabled', st.length >= 2 && st.every((o) => !o.disabled), j(st));
  R.check('p1: the warning is the unconfirmed-answer text, not the creator-only one', n.length === 1 && n[0].role === 'alert' && n[0].text !== FORBIDDEN, j(n));
  await option(ui.page, 'allow').click();
  const r = await waitResponds(ui.net, C.session, 2);
  R.check('p1: the second click reaches the real service: 202', r.length === 2 && r[0].status === 503 && r[1].status === 202, j(r.map((e) => e.status)));
  const t = await waitTurn(C.session, { timeoutMs: 60_000 });
  R.check('p1: the Turn completes and the file is written', t.status === 'COMPLETED' && readWs('a', `child/fc-${tag}.txt`) === written('retry-after-503'), `turn=${t.status}`);
  const gone = await waitNoCard(ui.page, { timeoutMs: 15_000 });
  await sleep(800);
  R.check('p1: card and warning leave', gone.ok && (await notice(ui.page)).length === 0, j(await notice(ui.page)));
  R.note('p1 console errors', j(ui.consoleErrors));
  await ui.context.close();
}

if (parts.includes('2')) {
  // ── part 2: bob's refused answer is still in flight when alice answers and the Turn raises E2.
  const E = await createSession('web', 'ws-a', `UI_SEQ n=2 name=fe-${tag} delay=5000`, { actor: 'alice' });
  R.check('p2: alice creates Session E (two approvals)', E.status === 202, `session=${E.session}`);
  const ui = await open(browser, { arm, actor: 'bob', lang, session: E.session });
  let release;
  const gate = new Promise((r) => (release = r));
  let held = 0;
  await ui.page.route('**/api/agent/web-shell/v1/actions/respond', async (route) => {
    if (held++ === 0) await gate;
    return route.continue();
  });
  const w = await waitCard(ui.page, { timeoutMs: 45_000 });
  R.check('p2: bob sees E1', w.ok, `after ${w.ms} ms`);
  await sleep(500);
  const e1 = (await listActions('web', E.session, { actor: 'alice' })).json.data?.find((a) => a.state === 'requested');
  await option(ui.page, 'allow').click();
  await sleep(500);
  R.note('p2: bob clicked Allow on E1; the request is held in the browser', `card count while held=${await card(ui.page).count()}`);
  const ans = await apiRespond('web', E.session, e1, 'allow', { actor: 'alice', key: `alice-${e1.actionId}` });
  R.check('p2: alice answers E1 while bob\'s request is held: 202', ans.status === 202, `HTTP ${ans.status}`);
  const p = await waitPending(E.session, { surface: 'web', actor: 'alice', not: [e1.actionId], timeoutMs: 60_000 });
  R.check('p2: the Turn raises E2', !p.timeout, `after ${p.ms} ms`);
  const t0 = Date.now();
  while (!calls(ui.net, '/actions/query').some((q) => q.res?.data?.some((x) => x.actionId === p.action.actionId)) && Date.now() - t0 < 20_000) await sleep(200);
  await card(ui.page).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await sleep(1000);
  const beforeRelease = await optionState(ui.page);
  R.check('p2: bob\'s page shows E2 while the E1 answer is still in flight; E2 is enabled (nothing known yet)', beforeRelease.length >= 2 && beforeRelease.every((o) => !o.disabled), j(beforeRelease));
  R.check('p2: E1 is already decided in the database', actionRow(e1.actionId)?.[0] === 'decided', j(actionRow(e1.actionId)));
  release();
  const r = await waitResponds(ui.net, E.session, 1);
  await sleep(1500);
  R.check('p2: the held answer reaches the real service after E1 was decided: 403 action_forbidden (owner check precedes the state check)', r[0]?.status === 403 && r[0]?.res?.error?.code === 'action_forbidden', j({ status: r[0]?.status, body: r[0]?.res }));
  const after = await optionState(ui.page);
  const n = await notice(ui.page);
  await shot(ui.page, `s2-${arm}-${lang}-p2-late-403`);
  if (HEAD) {
    R.check('p2 head: the late 403 still latches: E2 becomes disabled', after.length >= 2 && after.every((o) => o.disabled), j(after));
    R.check('p2 head: the reason shows as role=status, referenced by the dialog', n.length === 1 && n[0].role === 'status' && n[0].text === FORBIDDEN && n[0].referenced, j(n));
  } else {
    R.check('p2 base: E2 stays enabled with no reason', after.every((o) => !o.disabled) && n.length === 0, j({ after, n }));
  }
  const before2 = responds(ui.net, E.session).length;
  await pointerClick(ui.page, 'allow');
  await sleep(2000);
  const r2 = responds(ui.net, E.session).slice(before2);
  if (HEAD) R.check('p2 head: clicking E2 sends nothing', r2.length === 0, `new=${r2.length}`);
  else R.check('p2 base: clicking E2 sends another refused request', r2.length === 1 && r2[0].status === 403, j(r2.map((e) => e.status)));
  const e2 = p.action;
  const ans2 = await apiRespond('web', E.session, e2, 'allow', { actor: 'alice', key: `alice-${e2.actionId}` });
  const t = await waitTurn(E.session, { timeoutMs: 60_000 });
  R.check('p2: alice answers E2 and the Turn completes', ans2.status === 202 && t.status === 'COMPLETED' && executions(E.session) === 2, `turn=${t.status} executions=${executions(E.session)}`);
  R.note('p2 console errors', j(ui.consoleErrors));
  R.check('p2: no uncaught page error from the late rejection', !ui.consoleErrors.some((e) => e.startsWith('pageerror')), j(ui.consoleErrors));
  await ui.context.close();
}

if (parts.includes('3')) {
  // ── part 3: reload.
  const F = await createSession('web', 'ws-a', `UI_WRITE name=ff-${tag}.txt content=reload delay=5000`, { actor: 'alice' });
  R.check('p3: alice creates Session F', F.status === 202, `session=${F.session}`);
  let ui = await open(browser, { arm, actor: 'bob', lang, session: F.session });
  const w = await waitCard(ui.page, { timeoutMs: 45_000 });
  R.check('p3: bob sees F1', w.ok, `after ${w.ms} ms`);
  await sleep(500);
  await option(ui.page, 'allow').click();
  await waitResponds(ui.net, F.session, 1);
  await sleep(1200);
  const s1 = await optionState(ui.page);
  await shot(ui.page, `s2-${arm}-${lang}-p3-refused`);
  R.check(HEAD ? 'p3 head: refused and disabled' : 'p3 base: refused, still enabled', HEAD ? s1.every((o) => o.disabled) : s1.every((o) => !o.disabled), j(s1));
  const first = responds(ui.net, F.session).map((e) => e.status);
  await ui.context.close();
  ui = await open(browser, { arm, actor: 'bob', lang, session: F.session });
  const w2 = await waitCard(ui.page, { timeoutMs: 20_000 });
  await sleep(1200);
  const s2 = await optionState(ui.page);
  R.check('p3: after a reload the card is offered again (latch is per mount, as the PR states)', w2.ok && s2.every((o) => !o.disabled), j(s2));
  await option(ui.page, 'allow').click();
  await waitResponds(ui.net, F.session, 1);
  await sleep(1200);
  await pointerClick(ui.page, 'allow');
  await sleep(1500);
  const s3 = await optionState(ui.page);
  const second = responds(ui.net, F.session).map((e) => e.status);
  R.check(HEAD ? 'p3 head: the reload costs exactly one more refused request, then it latches again' : 'p3 base: every click after the reload is refused again', HEAD ? second.length === 1 && second[0] === 403 && s3.every((o) => o.disabled) : second.length === 2 && second.every((s) => s === 403), j({ beforeReload: first, afterReload: second }));
  const f1 = (await listActions('web', F.session, { actor: 'alice' })).json.data?.find((a) => a.state === 'requested');
  await apiRespond('web', F.session, f1, 'allow', { actor: 'alice', key: `alice-${f1.actionId}` });
  const t = await waitTurn(F.session, { timeoutMs: 60_000 });
  R.check('p3: alice answers F1 and the Turn completes', t.status === 'COMPLETED', `turn=${t.status}`);
  await ui.context.close();
}
await browser.close();
R.done();
process.exit(0);
