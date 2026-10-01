// VERIFICATION RIG ONLY (PR #13107): reproduce the /review findings R1-1..R1-8 (review 5375002256) on the real
// stack. A PASS line means "the reviewer's claim was reproduced"; a FAIL line means it was not.
// Faults are injected at the browser only where the finding is about the page's reaction to a response.
// usage: DB=<db> node s11-review-findings.mjs [ids...]   ids: r1-1a r1-1b r1-2 r1-3 r1-4 r1-5 r1-6 r1-8
import { api, createSession, ensureWorkspace, waitPending, waitTurn, listActions, getAction, respond, actionRow, readWs, executions, sql, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, option } from './ui.mjs';

const want = process.argv.slice(2);
const run = (id) => want.length === 0 || want.includes(id);
assertIdle();
const R = new Report(`s11-review-findings${want.length ? '-' + want.join('-') : ''}`);
ensureWorkspace(WS, `st-${ST}`);
const browser = await launch();
const alerts = async (page) => (await page.locator('[role="alert"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
const QUERY = '**/api/agent/web-shell/v1/actions/query';
const RESPOND = '**/api/agent/web-shell/v1/actions/respond';
const GET = '**/api/agent/web-shell/v1/sessions/get';
const STREAM = '**/api/agent/web-shell/v1/events/stream';
const fail503 = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rig_unavailable', message: 'rig 503' } }) });
const refresh = (page) => page.getByRole('button', { name: 'Refresh' }).first().click();

async function pending(tag, marker = 'UI_WRITE', extra = '') {
  const c = await createSession('web', WS, `${marker} name=s11-${tag}-${Date.now().toString(36)}.txt content=${tag} ${extra}`.trim());
  const p = await waitPending(c.session, { surface: 'web' });
  return { S: c.session, A: p.action };
}
async function finish(S) {
  // answer whatever is still pending through REST, then wait for the Turn, so the next case starts idle
  for (let i = 0; i < 6; i += 1) {
    const l = await listActions('public', S);
    const a = l.json.data?.[0];
    if (!a) break;
    await respond('public', S, a, 'deny', { key: `cleanup-${a.id}` });
    await sleep(1500);
  }
  return waitTurn(S, { timeoutMs: 60_000 });
}
// Samples the card every ~15 ms for `ms` and returns the longest stretch without it.
async function gapWhile(page, ms) {
  return page.evaluate(async (ms) => {
    const t0 = performance.now();
    let gapStart = null;
    let longest = 0;
    let gaps = 0;
    let buttonsDuringGap = 0;
    while (performance.now() - t0 < ms) {
      const present = !!document.querySelector('[data-testid="managed-approval"]');
      if (!present && gapStart === null) {
        gapStart = performance.now();
        gaps += 1;
      }
      if (!present && document.querySelector('[data-option-id="allow"]')) buttonsDuringGap += 1;
      if (present && gapStart !== null) {
        longest = Math.max(longest, performance.now() - gapStart);
        gapStart = null;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    if (gapStart !== null) longest = Math.max(longest, performance.now() - gapStart);
    return { gaps, longest: Math.round(longest), buttonsDuringGap };
  }, ms);
}

if (run('r1-1a')) {
  const { S } = await pending('r11a');
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  const q0 = calls(ui.net, '/actions/query').length;
  const sampler = gapWhile(ui.page, 4000);
  await sleep(300);
  await refresh(ui.page);
  const g = await sampler;
  R.check('[R1-1a] clicking Refresh removes the live card for a while (summary dropped → reader disabled)', g.gaps >= 1 && g.longest > 0, `gaps=${g.gaps} longest=${g.longest} ms, option buttons present during the gap: ${g.buttonsDuringGap > 0}`);
  R.note('[R1-1a] after the reload', `card=${await card(ui.page).count()} actions/query +${calls(ui.net, '/actions/query').length - q0}`);
  await ui.context.close();
  R.note('[R1-1a] cleanup', j(await finish(S)));
}

if (run('r1-1b')) {
  const { S } = await pending('r11b');
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  let gets = 0;
  await ui.page.route(GET, (route) => {
    gets += 1;
    return fail503(route);
  });
  // b1: the summary poll fails but no reload happens
  await sleep(7000);
  R.check('[R1-1b] summary route failing WITHOUT a reload: the card stays (summary kept from before)', (await card(ui.page).count()) === 1, `sessions/get failures=${gets} alerts=${j(await alerts(ui.page))}`);
  // b2: the user clicks Refresh during the outage
  const q0 = calls(ui.net, '/actions/query').length;
  await refresh(ui.page);
  await sleep(15000);
  const q1 = calls(ui.net, '/actions/query').length;
  R.check('[R1-1b] summary route failing + Refresh: the card stays away and Actions are not read for 15 s', (await card(ui.page).count()) === 0 && q1 === q0, `card=${await card(ui.page).count()} actions/query during outage=${q1 - q0} sessions/get failures=${gets} alerts=${j(await alerts(ui.page))}`);
  await shot(ui.page, 's11-r1-1b-summary-outage');
  const actionsHealthy = await listActions('web', S);
  R.note('[R1-1b] /actions/query is healthy meanwhile', `HTTP ${actionsHealthy.status}, requested=${actionsHealthy.json.data?.length}`);
  await ui.page.unroute(GET);
  const back = await waitCard(ui.page, { timeoutMs: 15_000 });
  R.note('[R1-1b] after the summary route recovers', `card back=${back.ok} after ${back.ms} ms (the summary poller runs every 3 s)`);
  await ui.context.close();
  R.note('[R1-1b] cleanup', j(await finish(S)));
}

if (run('r1-2')) {
  const { S, A } = await pending('r12');
  const tabA = await open(browser, { arm: 'head', session: S });
  const tabB = await open(browser, { arm: 'head', session: S });
  await Promise.all([waitCard(tabA.page), waitCard(tabB.page)]);
  // tab B stops receiving stream events (the request is held open, nothing is delivered)
  await tabB.page.route(STREAM, () => {});
  await refresh(tabB.page); // reconnect through the held route
  await waitCard(tabB.page);
  await option(tabA.page, 'allow').click();
  await waitNoCard(tabA.page);
  await sleep(2500);
  R.note('[R1-2] tab A answered "Yes, allow once"', `action=${actionRow(A.actionId)?.[0]} tab B card=${await card(tabB.page).count()}`);
  await option(tabB.page, 'deny').click();
  await sleep(1500);
  const r = calls(tabB.net, '/actions/respond').at(-1);
  R.check('[R1-2] the stale tab\'s "Reject" gets 409 for an ended Action, the card stays, and the page says "Retry the same option"', r?.status === 409 && (await card(tabB.page).count()) === 1 && (await alerts(tabB.page)).some((a) => /Retry the same option/.test(a)), `HTTP ${r?.status} ${r?.res?.error?.code ?? r?.res?.code} card=${await card(tabB.page).count()} alerts=${j(await alerts(tabB.page))}`);
  await shot(tabB.page, 's11-r1-2-ended-action');
  const q0 = calls(tabB.net, '/actions/query').length;
  await option(tabB.page, 'deny').click();
  await sleep(1500);
  const r2 = calls(tabB.net, '/actions/respond').at(-1);
  R.check('[R1-2] retrying the same option repeats the 409 and nothing re-reads the list', r2?.status === 409 && calls(tabB.net, '/actions/query').length === q0 && (await card(tabB.page).count()) === 1, `HTTP ${r2?.status} actions/query +${calls(tabB.net, '/actions/query').length - q0}`);
  R.note('[R1-2] outcome', `tool executions=${executions(S)} (tab A allowed; tab B clicked Reject twice)`);
  await Promise.all([tabA.context.close(), tabB.context.close()]);
  R.note('[R1-2] cleanup', j(await finish(S)));
}

if (run('r1-3')) {
  // two approvals in one Turn: write_file, then edit
  const c = await createSession('web', WS, `UI_FILES name=s11-r13-${Date.now().toString(36)}.txt`);
  const S = c.session;
  const p1 = await waitPending(S, { surface: 'web' });
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  let hits = 0;
  await ui.page.route(RESPOND, (route) => (++hits === 1 ? fail503(route) : route.continue()));
  await option(ui.page, 'allow').click();
  await sleep(1200);
  R.note('[R1-3] answer 1 failed (503)', `alerts=${j(await alerts(ui.page))}`);
  // the owner answers approval 1 somewhere else
  const d = await getAction('public', S, p1.action.actionId);
  await respond('public', S, d.json, 'allow', { key: `r13-rest-${Date.now()}` });
  const p2 = await waitPending(S, { surface: 'web', not: [p1.action.actionId] });
  await sleep(1500);
  const al = await alerts(ui.page);
  const cardText = (await card(ui.page).count()) ? await card(ui.page).innerText() : '';
  R.check('[R1-3] the "could not be confirmed" alert outlives approval 1 and sits beside approval 2', !!p2.action && /Edit|edit/.test(cardText) && al.some((a) => /could not be confirmed/.test(a)), `approval 2=${p2.action?.toolName} card=${cardText.replace(/\s+/g, ' ').slice(0, 60)} alerts=${j(al)}`);
  await shot(ui.page, 's11-r1-3-stale-alert');
  await ui.context.close();
  R.note('[R1-3] cleanup', j(await finish(S)));
}

if (run('r1-4')) {
  const { S } = await pending('r14');
  // browser clock ahead of the expiry so the page re-reads once soon after loading; that re-read fails once
  let reads = 0;
  const ui = await (async () => {
    const o = await open(browser, { arm: 'head', skewMs: 15 * 60_000 });
    await o.page.route(QUERY, (route) => (++reads === 2 ? fail503(route) : route.continue()));
    await o.page.evaluate((s) => window.__rig.select(s), S);
    return o;
  })();
  await waitCard(ui.page);
  await ui.page.locator('[role="alert"]', { hasText: 'Pending approvals could not be loaded' }).waitFor({ timeout: 10_000 }).catch(() => {});
  const both = (await card(ui.page).count()) === 1 && (await alerts(ui.page)).some((a) => /could not be loaded/.test(a));
  R.check('[R1-4] a failed background re-read shows "Pending approvals could not be loaded." beside a loaded card', both, `card=${await card(ui.page).count()} alerts=${j(await alerts(ui.page))} reads=${reads}`);
  await shot(ui.page, 's11-r1-4-banner-beside-card');
  await sleep(3000);
  R.note('[R1-4] 3 s later (2 s retry rung)', `card=${await card(ui.page).count()} alerts=${j(await alerts(ui.page))} reads=${reads}`);
  await ui.context.close();
  R.note('[R1-4] cleanup', j(await finish(S)));
}

if (run('r1-5')) {
  const { S } = await pending('r15');
  let reads = 0;
  const t0 = Date.now();
  const times = [];
  const ui = await (async () => {
    const o = await open(browser, { arm: 'head' });
    await o.page.route(QUERY, (route) => {
      reads += 1;
      times.push(Date.now() - t0);
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'session_not_found', message: 'The Session was not found.' }) });
    });
    await o.page.evaluate((s) => window.__rig.select(s), S);
    return o;
  })();
  await sleep(20_000);
  const al = await alerts(ui.page);
  R.check('[R1-5] a deterministic 404 is retried like a transient failure, then left with a Retry button and no server message', reads === 4 && (await ui.page.getByRole('button', { name: 'Retry loading approvals' }).count()) === 1 && !al.some((a) => /not found/i.test(a)), `reads=${reads} at ${j(times)} ms alerts=${j(al)}`);
  await ui.context.close();
  R.note('[R1-5] cleanup', j(await finish(S)));
}

if (run('r1-6')) {
  const { S } = await pending('r16');
  let reads = 0;
  let failUntil = 4;
  const ui = await (async () => {
    const o = await open(browser, { arm: 'head' });
    await o.page.route(QUERY, (route) => (++reads <= failUntil ? fail503(route) : route.continue()));
    await o.page.evaluate((s) => window.__rig.select(s), S);
    return o;
  })();
  await sleep(19_000);
  R.note('[R1-6] ladder exhausted', `reads=${reads} card=${await card(ui.page).count()}`);
  failUntil = reads + 1; // the read after Refresh fails once more, then the service is healthy
  await refresh(ui.page);
  await sleep(15_000);
  R.check('[R1-6] after Refresh, one more transient failure is not retried: no card for 15 s while the service is healthy', (await card(ui.page).count()) === 0 && reads === failUntil, `reads=${reads} card=${await card(ui.page).count()} alerts=${j(await alerts(ui.page))}`);
  await ui.context.close();
  R.note('[R1-6] cleanup', j(await finish(S)));
}

if (run('r1-8')) {
  const { S } = await pending('r18');
  const ui = await open(browser, { arm: 'head', session: S });
  await waitCard(ui.page);
  const d = await ui.page.evaluate(() => {
    const panel = document.querySelector('[data-web-shell-permission-panel]');
    const ids = (panel?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const texts = ids.map((id) => panel.querySelector(`[id="${id}"]`)?.textContent ?? document.getElementById(id)?.textContent ?? null);
    const notice = [...document.querySelectorAll('[data-testid="managed-approval"] [role="status"]')].map((e) => e.textContent);
    return { ids: ids.length, texts, notice, noticeInsidePanel: !!panel?.textContent?.includes('Tool arguments are unavailable') };
  });
  R.check('[R1-8] the arguments-unavailable notice is outside the dialog\'s aria-describedby', !d.texts.join(' ').includes('Tool arguments are unavailable') && d.notice.some((n) => /unavailable/.test(n)), `describedby texts=${j(d.texts)} notice=${j(d.notice)} insidePanel=${d.noticeInsidePanel}`);
  await ui.context.close();
  R.note('[R1-8] cleanup', j(await finish(S)));
}

await browser.close();
R.done();
process.exit(0);
