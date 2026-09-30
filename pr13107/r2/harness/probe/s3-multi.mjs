// VERIFICATION RIG ONLY (PR #13107): several viewers of one pending approval.
//   alice (creator/owner) has the Session open in two tabs; bob (may read, did not create) has it open too.
//   Part 1: bob answers -> the service refuses (403); alice answers in tab A -> tab B and bob's page drop the card.
//   Part 2: the owner answers through the public REST API while the page is open -> the card leaves.
// usage: DB=<db> node s3-multi.mjs
import { ensureWorkspace, createSession, waitPending, waitTurn, readWs, respond, getAction, actionRow, one, Report, sleep, j, written, assertIdle , WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, text, option } from './ui.mjs';

assertIdle();
const R = new Report('s3-multi');
ensureWorkspace(WS, `st-${ST}`);
const browser = await launch();

// ---- part 1
{
  const file = `s3a-${Date.now().toString(36)}.txt`;
  const c = await createSession('web', WS, `UI_WRITE name=${file} content=answered-in-tab-a`);
  const S = c.session;
  const p = await waitPending(S, { surface: 'web' });
  const A = p.action;
  const tabA = await open(browser, { arm: 'head', actor: 'alice', session: S });
  const tabB = await open(browser, { arm: 'head', actor: 'alice', session: S });
  const bob = await open(browser, { arm: 'head', actor: 'bob', session: S });
  const [wa, wb, wbob] = await Promise.all([waitCard(tabA.page), waitCard(tabB.page), waitCard(bob.page, { timeoutMs: 12_000 })]);
  R.check('owner: the card shows in both tabs', wa.ok && wb.ok, `tab A ${wa.ms} ms, tab B ${wb.ms} ms`);
  R.note('reader (bob, not the creator): is the card shown?', wbob.ok ? `yes, after ${wbob.ms} ms: ${await text(card(bob.page))}` : 'no card');
  if (wbob.ok) {
    await option(bob.page, 'allow').click();
    await sleep(2500);
    const r = calls(bob.net, '/actions/respond');
    R.check('reader answering is refused by the service (403 action_forbidden)', r.length >= 1 && r[0].status === 403 && r[0].res?.error?.code === 'action_forbidden', `HTTP ${r[0]?.status} ${j(r[0]?.res?.error)}`);
    const bobText = (await bob.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
    R.check('reader page: the card comes back with the creator-only message', (await card(bob.page).count()) === 1 && /Only the Session creator can answer this approval/.test(bobText), bobText.slice(-300));
    R.check('the refused answer changed nothing', actionRow(A.actionId)?.[0] === 'requested' && one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${S}'`) === '0' && readWs(ST, `child/${file}`) === null, `state=${actionRow(A.actionId)?.[0]}`);
    await shot(bob.page, 's3-reader-refused');
  }
  const t0 = Date.now();
  await option(tabA.page, 'allow').click();
  const [ga, gb, gbob] = await Promise.all([waitNoCard(tabA.page), waitNoCard(tabB.page), wbob.ok ? waitNoCard(bob.page) : Promise.resolve({ ok: true, ms: 0 })]);
  R.check('owner answers in tab A: the card leaves tab A', ga.ok, `${ga.ms} ms`);
  R.check('tab B drops the card without a reload (action.updated)', gb.ok, `${gb.ms} ms after the click in tab A`);
  R.check("the reader's page drops the card too", gbob.ok, `${gbob.ms} ms`);
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  R.check('Turn completes; the file is written once', t.status === 'COMPLETED' && readWs(ST, `child/${file}`) === written('answered-in-tab-a'), `status=${t.status} content=${readWs(ST, `child/${file}`)}`);
  R.check('only tab A sent an answer', calls(tabA.net, '/actions/respond').length === 1 && calls(tabB.net, '/actions/respond').length === 0, '');
  await sleep(1500);
  const bobAfter = (await bob.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
  R.note('reader page after the owner answered: error text still shown?', /Only the Session creator|could not be/i.test(bobAfter) ? 'yes' : 'no');
  await Promise.all([tabA.context.close(), tabB.context.close(), bob.context.close()]);
}

// ---- part 2
{
  const file = `s3b-${Date.now().toString(36)}.txt`;
  const c = await createSession('web', WS, `UI_WRITE name=${file} content=answered-through-rest`);
  const S = c.session;
  const p = await waitPending(S, { surface: 'public' });
  const ui = await open(browser, { arm: 'head', actor: 'alice', session: S });
  const w = await waitCard(ui.page);
  R.check('part 2: the card is shown', w.ok, `${w.ms} ms`);
  const detail = await getAction('public', S, p.action.id);
  const r = await respond('public', S, detail.json, 'deny', { key: `rest-${Date.now()}` });
  const t0 = Date.now();
  const g = await waitNoCard(ui.page);
  R.check('answered through the public REST API: the card leaves the open page', r.status === 202 && g.ok, `HTTP ${r.status}; card gone ${Date.now() - t0} ms after the REST answer`);
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  R.check('Turn completes with the denial; file not written', t.status === 'COMPLETED' && readWs(ST, `child/${file}`) === null, `status=${t.status}`);
  R.check('the page itself sent no answer', calls(ui.net, '/actions/respond').length === 0, '');
  await ui.context.close();
}
await browser.close();
R.done();
process.exit(0);
