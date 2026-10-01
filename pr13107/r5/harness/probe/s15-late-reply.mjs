// VERIFICATION RIG ONLY (PR #13107): round 5b — a90b7966e4 / 72608f2c03 "isolate late Managed approval replies".
// The page's answer request is held in the browser while the page moves on, then released:
//   switch  the user switches to another Session (its own pending approval) before the old answer returns
//   replace the answered approval is resolved elsewhere and the Turn's next approval replaces it on the card
// and the held answer then fails (503) or is let through to the real service ("late": for switch it succeeds; for
// replace the service answers 409 action_already_resolved, because approval 1 was answered elsewhere meanwhile).
// usage: DB=<db> node s15-late-reply.mjs <switch|replace>:<fails|late>:<arm> ...
import { createSession, ensureWorkspace, waitPending, waitTurn, listActions, getAction, respond, executions, Report, sleep, j, assertIdle } from './lib.mjs';
import { launch, open, waitCard, shot, card, calls, option } from './ui.mjs';

const want = process.argv.slice(2);
assertIdle();
const R = new Report(`s15-late-reply-${want.join('-').replace(/:/g, '_')}`);
ensureWorkspace('ws-a', 'st-a');
ensureWorkspace('ws-b', 'st-b');
const browser = await launch();
const RESPOND = '**/api/agent/web-shell/v1/actions/respond';
const alerts = async (page) => (await page.locator('[role="alert"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
const cardText = async (page) => ((await card(page).count()) ? (await card(page).innerText()).replace(/\s+/g, ' ').slice(0, 70) : '');
async function finish(S) {
  for (let i = 0; i < 6; i += 1) {
    const l = await listActions('public', S);
    const a = l.json.data?.[0];
    if (!a) break;
    await respond('public', S, a, 'deny', { key: `cleanup-${a.id}` });
    await sleep(1500);
  }
  return waitTurn(S, { timeoutMs: 60_000 });
}
async function hold(page, outcome) {
  let release;
  const gate = new Promise((r) => (release = r));
  let seen = 0;
  await page.route(RESPOND, async (route) => {
    seen += 1;
    if (seen > 1) return route.continue();
    await gate;
    return outcome === 'fails'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rig_unavailable', message: 'rig 503' } }) })
      : route.continue();
  });
  return () => release();
}

for (const spec of want) {
  const [kind, outcome, arm] = spec.split(':');
  const tag = `[${kind}·${outcome}·${arm}]`;

  if (kind === 'switch') {
    const one = await createSession('web', 'ws-a', `UI_WRITE name=s15-one-${Date.now().toString(36)}.txt content=one`);
    const two = await createSession('web', 'ws-b', `UI_WRITE name=s15-two-${Date.now().toString(36)}.txt content=two`);
    await Promise.all([waitPending(one.session, { surface: 'web' }), waitPending(two.session, { surface: 'web' })]);
    const ui = await open(browser, { arm, session: one.session });
    await waitCard(ui.page);
    const release = await hold(ui.page, outcome);
    await option(ui.page, 'allow').click();
    await sleep(300);
    await ui.page.evaluate((s) => window.__rig.select(s), two.session);
    await waitCard(ui.page);
    await sleep(1000);
    const before = { card: await cardText(ui.page), alerts: await alerts(ui.page) };
    release();
    await sleep(2500);
    const after = { card: await cardText(ui.page), alerts: await alerts(ui.page), respond: calls(ui.net, '/actions/respond').map((c) => c.status) };
    const d = `Session 2 shown before the old reply: ${j(before)}; after it: ${j(after)}; Session 1 executions=${executions(one.session)}`;
    const clean = after.card !== '' && after.alerts.length === 0;
    if (arm === 'head') R.check(`${tag} the old Session's late reply leaves Session 2's card alone: card shown, no warning`, clean, d);
    else R.check(`${tag} before: ${outcome === 'fails' ? "the old Session's failure is announced beside Session 2's card" : 'Session 2 is unaffected by the late success'}`, outcome === 'fails' ? after.card !== '' && after.alerts.some((a) => /could not be confirmed/.test(a)) : clean, d);
    await shot(ui.page, `s15-${kind}-${outcome}-${arm}`);
    if (outcome === 'late') {
      const t = await waitTurn(one.session);
      R.check(`${tag} the late answer still applied to Session 1`, t.status === 'COMPLETED' && executions(one.session) === 1, `turn=${t.status} executions=${executions(one.session)}`);
    }
    await ui.context.close();
    R.note(`${tag} cleanup`, j([await finish(one.session), await finish(two.session)]));
  }

  if (kind === 'replace') {
    const c = await createSession('web', 'ws-a', `UI_FILES name=s15-r-${Date.now().toString(36)}.txt`);
    const S = c.session;
    const p1 = await waitPending(S, { surface: 'web' });
    const ui = await open(browser, { arm, session: S });
    await waitCard(ui.page);
    const release = await hold(ui.page, outcome);
    await option(ui.page, 'allow').click();
    await sleep(300);
    // approval 1 is answered somewhere else; the Turn moves on to approval 2
    const d1 = await getAction('public', S, p1.action.actionId);
    await respond('public', S, d1.json, 'allow', { key: `s15-rest-${Date.now()}` });
    const p2 = await waitPending(S, { surface: 'web', not: [p1.action.actionId] });
    await ui.page.waitForFunction(() => /edit/i.test(document.querySelector('[data-testid="managed-approval"]')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {});
    const before = { card: await cardText(ui.page), alerts: await alerts(ui.page) };
    release();
    await sleep(2500);
    const after = { card: await cardText(ui.page), alerts: await alerts(ui.page), respond: calls(ui.net, '/actions/respond').map((x) => `${x.status}${x.res?.error?.code ? ' ' + x.res.error.code : ''}`) };
    const d = `approval 2=${p2.action?.toolName}; before the late reply: ${j(before)}; after: ${j(after)}`;
    const clean = /edit/i.test(after.card) && after.alerts.length === 0;
    if (arm === 'head') R.check(`${tag} approval 1's late reply leaves approval 2's card alone: card shown, no warning`, clean, d);
    else R.check(`${tag} before: approval 1's ${outcome === 'fails' ? '503' : '409'} is announced beside approval 2`, /edit/i.test(after.card) && after.alerts.some((a) => /could not be confirmed/.test(a)), d);
    await shot(ui.page, `s15-${kind}-${outcome}-${arm}`);
    await ui.context.close();
    R.note(`${tag} cleanup`, j(await finish(S)));
  }
}
await browser.close();
R.done();
process.exit(0);
