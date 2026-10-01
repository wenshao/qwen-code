// VERIFICATION RIG ONLY (PR #13107): the R1-1 fix at 9522974f9d — an unknown Session summary keeps the shown
// approval (tri-state `enabled`). Checks the fix and the edges it creates.
//   a  healthy Refresh: no gap, and a click during the reload window is delivered
//   b  summary route failing + Refresh: the card stays and can be answered; the Turn continues
//   c  summary route failing + Refresh while the Action ends elsewhere: what the stale card does
//   d  Session switch: another Session's approval never shows on this one; a Session without Actions is not read
// usage: DB=<db> node s12-r1-1-fix.mjs [a b c d]
import { api, createSession, ensureWorkspace, waitPending, waitTurn, listActions, getAction, respond, actionRow, readWs, executions, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, option } from './ui.mjs';

const want = process.argv.slice(2);
const run = (id) => want.length === 0 || want.includes(id);
assertIdle();
const R = new Report(`s12-r1-1-fix${want.length ? '-' + want.join('') : ''}`);
ensureWorkspace(WS, `st-${ST}`);
const browser = await launch();
const alerts = async (page) => (await page.locator('[role="alert"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
const GET = '**/api/agent/web-shell/v1/sessions/get';
const fail503 = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rig_unavailable', message: 'rig 503' } }) });
const refresh = (page) => page.getByRole('button', { name: 'Refresh' }).first().click();
async function pending(tag) {
  const file = `s12-${tag}-${Date.now().toString(36)}.txt`;
  const c = await createSession('web', WS, `UI_WRITE name=${file} content=${tag}`);
  const p = await waitPending(c.session, { surface: 'web' });
  return { S: c.session, A: p.action, file };
}
async function finish(S) {
  for (let i = 0; i < 4; i += 1) {
    const l = await listActions('public', S);
    const a = l.json.data?.[0];
    if (!a) break;
    await respond('public', S, a, 'deny', { key: `cleanup-${a.id}` });
    await sleep(1500);
  }
  return waitTurn(S, { timeoutMs: 60_000 });
}
async function gapWhile(page, ms) {
  return page.evaluate(async (ms) => {
    const t0 = performance.now();
    let gaps = 0;
    let gapStart = null;
    let longest = 0;
    while (performance.now() - t0 < ms) {
      const present = !!document.querySelector('[data-testid="managed-approval"] [data-option-id="allow"]');
      if (!present && gapStart === null) { gapStart = performance.now(); gaps += 1; }
      if (present && gapStart !== null) { longest = Math.max(longest, performance.now() - gapStart); gapStart = null; }
      await new Promise((r) => setTimeout(r, 5));
    }
    if (gapStart !== null) longest = Math.max(longest, performance.now() - gapStart);
    return { gaps, longest: Math.round(longest) };
  }, ms);
}

if (run('a')) {
  const { S, file } = await pending('a');
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  const sampler = gapWhile(ui.page, 3000);
  await sleep(200);
  await refresh(ui.page);
  const g = await sampler;
  R.check('[a] healthy Refresh: the card and its buttons never leave', g.gaps === 0, j(g));
  // click while a reload is in flight: hold the summary for 1.5 s so the click lands inside the window
  await ui.page.route(GET, async (route) => { await sleep(1500); return route.continue().catch(() => {}); });
  await refresh(ui.page);
  await sleep(300);
  await option(ui.page, 'allow').click();
  await sleep(2500);
  await ui.page.unroute(GET);
  const t = await waitTurn(S);
  await sleep(1000);
  R.check('[a] "Yes, allow once" clicked during the reload window is delivered', calls(ui.net, '/actions/respond').length === 1 && t.status === 'COMPLETED' && readWs(ST, `child/${file}`) !== null && executions(S) === 1, `responds=${calls(ui.net, '/actions/respond').length} turn=${t.status} executions=${executions(S)}`);
  await ui.context.close();
}

if (run('b')) {
  const { S, file } = await pending('b');
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  await ui.page.route(GET, fail503);
  const q0 = calls(ui.net, '/actions/query').length;
  await refresh(ui.page);
  await sleep(6000);
  R.check('[b] summary route failing + Refresh: the card stays', (await card(ui.page).count()) === 1, `alerts=${j(await alerts(ui.page))} actions/query during outage=${calls(ui.net, '/actions/query').length - q0}`);
  await shot(ui.page, 's12-b-outage-card-kept');
  await option(ui.page, 'allow').click();
  const g = await waitNoCard(ui.page, { timeoutMs: 5000 });
  const t = await waitTurn(S);
  R.check('[b] answering during the outage reaches the service; the tool runs once', g.ok && calls(ui.net, '/actions/respond').at(-1)?.status === 202 && t.status === 'COMPLETED' && executions(S) === 1 && readWs(ST, `child/${file}`) !== null, `respond=${calls(ui.net, '/actions/respond').at(-1)?.status} turn=${t.status} executions=${executions(S)}`);
  R.note('[b] Actions reads while the summary was unknown', String(calls(ui.net, '/actions/query').length - q0));
  await ui.page.unroute(GET);
  await ui.context.close();
}

if (run('c')) {
  const { S, A, file } = await pending('c');
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  await ui.page.route(GET, fail503);
  await refresh(ui.page);
  await sleep(1500);
  // the owner answers elsewhere while this page cannot load the summary
  const d = await getAction('public', S, A.actionId);
  await respond('public', S, d.json, 'deny', { key: `c-rest-${Date.now()}` });
  await waitTurn(S);
  await sleep(4000);
  R.note('[c] Action answered elsewhere during the outage', `action=${actionRow(A.actionId)?.[0]} card on this page=${await card(ui.page).count()} alerts=${j(await alerts(ui.page))}`);
  await option(ui.page, 'allow').click();
  await sleep(1500);
  const r = calls(ui.net, '/actions/respond').at(-1);
  R.check('[c] the kept card is stale: "allow" gets 409 for the ended Action and nothing ran', r?.status === 409 && executions(S) === 0 && readWs(ST, `child/${file}`) === null, `HTTP ${r?.status} ${r?.res?.code ?? r?.res?.error?.code} executions=${executions(S)} alerts=${j(await alerts(ui.page))}`);
  await shot(ui.page, 's12-c-stale-card-409');
  await ui.page.unroute(GET);
  const gone = await waitNoCard(ui.page, { timeoutMs: 15_000 });
  R.note('[c] after the summary route recovers', `card gone=${gone.ok} after ${gone.ms} ms alerts=${j(await alerts(ui.page))}`);
  await ui.context.close();
}

if (run('d')) {
  const one = await pending('d1');
  // a second Workspace so both Sessions can wait at the same time
  ensureWorkspace('ws-b', 'st-b');
  const c2 = await createSession('web', 'ws-b', `UI_WRITE name=s12-d2-${Date.now().toString(36)}.txt content=d2`);
  const two = { S: c2.session, A: (await waitPending(c2.session, { surface: 'web' })).action };
  const plain = await api('POST', '/api/agent/web-shell/v1/sessions/create', { agentId: 'qwen-code', idempotencyKey: `plain-${Date.now()}`, input: [{ type: 'input_text', text: 'hello' }] });
  const P = plain.json.sessionId;
  await waitTurn(P, { timeoutMs: 60_000 });
  const pSummary = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: P });
  R.note('[d] a Session without a Workspace', `capabilities=${j(pSummary.json.capabilities)}`);
  const ui = await open(browser, { arm: 'head', session: one.S });
  await waitCard(ui.page);
  // hold Session 2's Action read for 1.5 s: any card under Session 2 before that can only be Session 1's data
  await ui.page.route('**/api/agent/web-shell/v1/actions/query', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.sessionId === two.S) await sleep(1500);
    return route.continue().catch(() => {});
  });
  const sawWrong = await ui.page.evaluate(async ([first, second]) => {
    window.__rig.select(second);
    const seen = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      const header = document.querySelector('section span.font-medium')?.textContent ?? '';
      const cardShown = !!document.querySelector('[data-testid="managed-approval"]');
      seen.push({ t: Math.round(performance.now() - t0), header: header.slice(0, 8), cardShown });
      await new Promise((r) => setTimeout(r, 10));
    }
    return seen;
  }, [one.S, two.S]);
  const byHeader = sawWrong.filter((s) => s.cardShown && s.header !== one.S.slice(0, 8) && s.t < 1400);
  R.note('[d] first samples after selecting Session 2', j(sawWrong.slice(0, 4)));
  const q = calls(ui.net, '/actions/query');
  R.check('[d] switching Sessions never shows the first Session\'s approval on the second', byHeader.length === 0, `samples with a card under a non-Session-1 header before Session 2\'s read returned: ${byHeader.length} of ${sawWrong.filter((s) => s.t < 1400).length}`);
  R.check('[d] the second Session\'s own card appears', (await card(ui.page).count()) === 1 && q.some((e) => e.req?.sessionId === two.S), `queries for S2=${q.filter((e) => e.req?.sessionId === two.S).length}`);
  const before = calls(ui.net, '/actions/query').length;
  await ui.page.evaluate((s) => window.__rig.select(s), P);
  await sleep(4000);
  R.check('[d] a Session without the Actions capability is not read and shows no card', calls(ui.net, '/actions/query').filter((e) => e.req?.sessionId === P).length === 0 && (await card(ui.page).count()) === 0, `queries for the plain Session=${calls(ui.net, '/actions/query').filter((e) => e.req?.sessionId === P).length} card=${await card(ui.page).count()} (all queries since switch=${calls(ui.net, '/actions/query').length - before})`);
  await ui.context.close();
  R.note('[d] cleanup', j([await finish(one.S), await finish(two.S)]));
}

await browser.close();
R.done();
process.exit(0);
