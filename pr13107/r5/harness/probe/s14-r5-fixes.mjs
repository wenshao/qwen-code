// VERIFICATION RIG ONLY (PR #13107): round 5 — the fixes that landed after round 4, on the real stack.
// Each case runs on the arms given (head = 9fedb263a0, prev = 24b26f107d, the round-4 head).
//   a  R1-2: a stale tab answers an Action another tab already answered (real 409 action_already_resolved)
//   b  the "wrong report" safety: a 409 action_already_resolved for an Action the service still lists
//   c  a lagging tab answers just after expiresAt (real 409 action_expired; needs a short approval timeout)
//   d  R1-4: first load fails vs. a background re-read fails beside a loaded card
//   e  R1-5: a 404 from actions/query; then the alert's Retry button
//   f  R1-8: the browser-computed accessible description of the approval dialog
//   g  R1-7: the Harness's per-call title on the card (Item injected in Java's materializeTool shape)
// usage: DB=<db> node s14-r5-fixes.mjs <case:arm> ...   e.g. a:head a:prev
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSession, ensureWorkspace, waitPending, waitTurn, listActions, respond, actionRow, executions, readWs, written, Report, sleep, j, assertIdle, WS, ST, RIG } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, option } from './ui.mjs';

const want = process.argv.slice(2);
assertIdle();
const R = new Report(`s14-r5-fixes-${want.join('-').replace(/:/g, '_')}`);
ensureWorkspace(WS, `st-${ST}`);
const browser = await launch();
const QUERY = '**/api/agent/web-shell/v1/actions/query';
const RESPOND = '**/api/agent/web-shell/v1/actions/respond';
const STREAM = '**/api/agent/web-shell/v1/events/stream';
const TRANSCRIPT = '**/api/agent/web-shell/v1/transcript/query';
const BODY409 = `${RIG}/out/r5db/real-409-action_already_resolved.json`;
const alerts = async (page) => (await page.locator('[role="alert"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
const refresh = (page) => page.getByRole('button', { name: 'Refresh' }).first().click();

async function pending(tag, marker = 'UI_WRITE') {
  const name = `s14-${tag}-${Date.now().toString(36)}.txt`;
  const c = await createSession('web', WS, `${marker} name=${name} content=${tag}`);
  const p = await waitPending(c.session, { surface: 'web' });
  return { S: c.session, A: p.action, name };
}
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
// Samples the card every ~15 ms: when it first went away, whether and when it came back, and the state at the end.
async function track(page, ms) {
  return page.evaluate(async (ms) => {
    const t0 = performance.now();
    let goneAt = null;
    let backAt = null;
    while (performance.now() - t0 < ms) {
      const present = !!document.querySelector('[data-testid="managed-approval"]');
      if (!present && goneAt === null) goneAt = Math.round(performance.now() - t0);
      if (present && goneAt !== null && backAt === null) backAt = Math.round(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 15));
    }
    return { goneAt, backAt, presentAtEnd: !!document.querySelector('[data-testid="managed-approval"]') };
  }, ms);
}
async function axDescription(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-web-shell-permission-panel]' });
  if (!nodeId) return { found: false };
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const n = nodes[0];
  const ids = await page.evaluate(() => (document.querySelector('[data-web-shell-permission-panel]')?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
  const dangling = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), ids);
  return { found: true, role: n?.role?.value, name: n?.name?.value, description: n?.description?.value ?? '', ids: ids.length, dangling };
}
function injectItem(page, A, S, attributes) {
  return page.route(TRANSCRIPT, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const seq = (body.lastSequence ?? 0) + 1000;
    body.items = [
      ...(body.items ?? []),
      { itemId: `item_tool_${randomUUID()}`, sessionId: S, turnId: A.turnId, type: 'tool_call', role: 'assistant', status: 'in_progress', content: [], attributes: { toolCallId: A.functionCallId, kind: 'tool_call', status: 'pending', name: 'write_file', ...attributes }, firstSequence: seq, lastSequence: seq, createdAt: Date.now(), updatedAt: Date.now() },
    ];
    return route.fulfill({ response, json: body });
  });
}

for (const spec of want) {
  const [id, arm] = spec.split(':');
  const tag = `[${id}·${arm}]`;

  if (id === 'a') {
    const { S, A } = await pending(`a-${arm}`);
    const tabA = await open(browser, { arm, session: S });
    const tabB = await open(browser, { arm, session: S });
    await Promise.all([waitCard(tabA.page), waitCard(tabB.page)]);
    await tabB.page.route(STREAM, () => {}); // tab B stops hearing about the Action
    await refresh(tabB.page);
    await waitCard(tabB.page);
    await option(tabA.page, 'allow').click();
    await waitNoCard(tabA.page);
    await sleep(2500);
    const q0 = calls(tabB.net, '/actions/query').length;
    await option(tabB.page, 'deny').click();
    const tr = await track(tabB.page, 6000);
    const r = calls(tabB.net, '/actions/respond').at(-1);
    if (r?.status === 409 && arm === 'head') fs.writeFileSync(BODY409, JSON.stringify(r.res));
    const al = await alerts(tabB.page);
    const q = calls(tabB.net, '/actions/query').length - q0;
    const d = `HTTP ${r?.status} ${r?.res?.error?.code ?? r?.res?.code} card gone at ${tr.goneAt} ms, back at ${tr.backAt}, present after 6 s=${tr.presentAtEnd}, actions/query +${q}, alerts=${j(al)}`;
    if (arm === 'head') R.check(`${tag} R1-2 fixed: the stale tab's Reject gets 409 action_already_resolved, the card leaves at once, the list is read again, and no warning is shown`, r?.status === 409 && tr.goneAt !== null && tr.goneAt < 1500 && tr.backAt === null && q >= 1 && al.length === 0, d);
    else R.check(`${tag} before: the card stays and the page says "Retry the same option"`, r?.status === 409 && tr.presentAtEnd && al.some((a) => /Retry the same option/.test(a)), d);
    await shot(tabB.page, `s14-a-${arm}`);
    R.note(`${tag} outcome`, `action=${actionRow(A.actionId)?.[0]} executions=${executions(S)} (tab A allowed)`);
    await Promise.all([tabA.context.close(), tabB.context.close()]);
    R.note(`${tag} cleanup`, j(await finish(S)));
  }

  if (id === 'b') {
    const body = fs.existsSync(BODY409) ? JSON.parse(fs.readFileSync(BODY409, 'utf8')) : null;
    if (!body) {
      R.check(`${tag} needs the real 409 body captured by case a·head`, false, BODY409);
      continue;
    }
    const { S, A, name } = await pending(`b-${arm}`);
    const ui = await open(browser, { arm, session: S });
    await waitCard(ui.page);
    let injected = 0;
    await ui.page.route(RESPOND, (route) => (injected++ === 0 ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(body) }) : route.continue()));
    const q0 = calls(ui.net, '/actions/query').length;
    await option(ui.page, 'allow').click();
    const tr = await track(ui.page, 5000);
    const q = calls(ui.net, '/actions/query').length - q0;
    const al = await alerts(ui.page);
    const d = `real body replayed=${j(body)}; card gone at ${tr.goneAt} ms, back at ${tr.backAt} ms, actions/query +${q}, alerts=${j(al)}`;
    if (arm === 'head') R.check(`${tag} a wrong "already resolved" for a live Action hides the card only until the next read lists it again`, tr.goneAt !== null && tr.backAt !== null && tr.presentAtEnd && q >= 1 && al.length === 0, d);
    else R.check(`${tag} before: the card stays with "Retry the same option"`, tr.presentAtEnd && al.some((a) => /Retry the same option/.test(a)), d);
    await shot(ui.page, `s14-b-${arm}`);
    await option(ui.page, 'allow').click();
    const gone = await waitNoCard(ui.page, { timeoutMs: 10_000 });
    const t = await waitTurn(S);
    const r = calls(ui.net, '/actions/respond').at(-1);
    R.check(`${tag} the restored card still answers: the real Allow is applied once`, gone.ok && r?.status === 202 && t.status === 'COMPLETED' && executions(S) === 1 && readWs(ST, `child/${name}`) === written(`b-${arm}`), `respond HTTP ${r?.status}, turn=${t.status}, executions=${executions(S)}, file=${j(readWs(ST, `child/${name}`))}`);
    await ui.context.close();
  }

  if (id === 'c') {
    const { S, A } = await pending(`c-${arm}`);
    const ui = await open(browser, { arm, session: S });
    await waitCard(ui.page);
    // The page stops hearing the stream (a lagging client), so it learns of the expiry only by answering.
    await ui.page.route(STREAM, () => {});
    await refresh(ui.page);
    await waitCard(ui.page);
    const wait = A.expiresAt - Date.now();
    R.note(`${tag} expiresAt`, `in ${wait} ms`);
    if (wait > 0) await sleep(wait + 150);
    const r0 = calls(ui.net, '/actions/respond').length;
    const clicked = await option(ui.page, 'allow').click({ timeout: 300 }).then(() => true, () => false);
    const tr = await track(ui.page, 4000);
    const r = calls(ui.net, '/actions/respond').length > r0 ? calls(ui.net, '/actions/respond').at(-1) : undefined;
    const al = await alerts(ui.page);
    const d = `clicked=${clicked} at expiresAt+${Date.now() - A.expiresAt - 4000} ms; respond HTTP ${r?.status} ${r?.res?.error?.code ?? r?.res?.code}; card gone at ${tr.goneAt} ms; alerts after 4 s=${j(al)}`;
    if (!clicked || r?.status !== 409) R.note(`${tag} the click missed the window (card already gone or answer accepted)`, d);
    else if (arm === 'head') R.check(`${tag} an answer refused as expired: the card leaves and no warning is left behind`, tr.goneAt !== null && tr.goneAt < 1500 && !tr.presentAtEnd && al.length === 0, d);
    else R.check(`${tag} before: the card leaves when the expiry lands, but "could not be confirmed" stays on an empty panel`, !tr.presentAtEnd && al.some((a) => /could not be confirmed/.test(a)), d);
    await shot(ui.page, `s14-c-${arm}`);
    R.note(`${tag} outcome`, `action=${actionRow(A.actionId)?.[0]} executions=${executions(S)}`);
    await ui.context.close();
    R.note(`${tag} cleanup`, j(await finish(S)));
  }

  if (id === 'd') {
    const { S } = await pending(`d-${arm}`);
    let reads = 0;
    // read 1 fails (first load), read 2 (the 2 s retry) succeeds, read 3 (the expiry re-read the skewed clock
    // brings forward) fails beside the loaded card
    const o = await open(browser, { arm, skewMs: 15 * 60_000 });
    await o.page.route(QUERY, (route) => (++reads === 1 || reads === 3 ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"rig_unavailable","message":"rig 503"}' }) : route.continue()));
    await o.page.evaluate((s) => window.__rig.select(s), S);
    await o.page.locator('[role="alert"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
    const first = { card: await card(o.page).count(), alerts: await alerts(o.page) };
    await waitCard(o.page, { timeoutMs: 10_000 });
    await o.page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].length > 0, null, { timeout: 10_000 }).catch(() => {});
    const second = { card: await card(o.page).count(), alerts: await alerts(o.page), reads };
    const d = `first load failed: card=${first.card} alerts=${j(first.alerts)}; background re-read failed: card=${second.card} alerts=${j(second.alerts)} reads=${second.reads}`;
    if (arm === 'head') R.check(`${tag} R1-4 fixed: a failed first load says "could not be loaded"; a failed refresh beside the card says "could not be refreshed"`, first.card === 0 && first.alerts.some((a) => /could not be loaded/.test(a)) && second.card === 1 && second.alerts.some((a) => /could not be refreshed/.test(a)), d);
    else R.check(`${tag} before: both say "could not be loaded"`, second.card === 1 && second.alerts.some((a) => /could not be loaded/.test(a)), d);
    await shot(o.page, `s14-d-${arm}`);
    await o.context.close();
    R.note(`${tag} cleanup`, j(await finish(S)));
  }

  if (id === 'e') {
    const { S } = await pending(`e-${arm}`);
    let reads = 0;
    let fail = true;
    const o = await open(browser, { arm });
    await o.page.route(QUERY, (route) => {
      reads += 1;
      return fail ? route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'session_not_found', message: 'The Session was not found.' }) }) : route.continue();
    });
    await o.page.evaluate((s) => window.__rig.select(s), S);
    await sleep(20_000);
    const retryButton = o.page.getByRole('button', { name: 'Retry loading approvals' });
    const at20 = { reads, retry: await retryButton.count(), alerts: await alerts(o.page) };
    fail = false;
    if (at20.retry) await retryButton.click();
    const back = await waitCard(o.page, { timeoutMs: 8000 });
    const d = `reads in 20 s=${at20.reads}, Retry button=${at20.retry}, alerts=${j(at20.alerts)}; after Retry (service healthy): card=${back.ok} reads=${reads}`;
    if (arm === 'head') R.check(`${tag} R1-5 fixed: a 404 is read once, not retried; the Retry button still reads again on demand`, at20.reads === 1 && at20.retry === 1 && back.ok && reads === 2, d);
    else R.check(`${tag} before: a 404 is read four times`, at20.reads === 4, d);
    await o.context.close();
    R.note(`${tag} cleanup`, j(await finish(S)));
  }

  if (id === 'f') {
    const { S, A } = await pending(`f-${arm}`);
    const ui = await open(browser, { arm, session: S });
    await waitCard(ui.page);
    const plain = await axDescription(ui.page);
    await ui.context.close();
    const ui2 = await open(browser, { arm });
    await injectItem(ui2.page, A, S, { title: 'WriteFile', input: { file_path: 'probe.txt', content: 'INJECTED-ARGUMENT-BYTES' } });
    await ui2.page.evaluate((s) => window.__rig.select(s), S);
    await waitCard(ui2.page);
    await sleep(800);
    const withArgs = await axDescription(ui2.page);
    await ui2.context.close();
    const d = `no arguments: ${j(plain)}; with arguments: ${j(withArgs)}`;
    if (arm === 'head') R.check(`${tag} R1-8 fixed: Chromium's accessible description of the dialog includes the arguments caveat, and no IDREF dangles when arguments are shown`, /Tool arguments are unavailable/.test(plain.description) && plain.dangling.length === 0 && !/unavailable/.test(withArgs.description) && withArgs.dangling.length === 0, d);
    else R.check(`${tag} before: the caveat is not in the accessible description`, plain.found && !/Tool arguments are unavailable/.test(plain.description), d);
    R.note(`${tag} cleanup`, j(await finish(S)));
  }

  if (id === 'g') {
    const { S, A } = await pending(`g-${arm}`);
    const ui = await open(browser, { arm });
    await injectItem(ui.page, A, S, { title: 'Write RIG-TITLE-13107 probe.txt' });
    await ui.page.evaluate((s) => window.__rig.select(s), S);
    await waitCard(ui.page);
    await sleep(800);
    const head = (await card(ui.page).locator('[data-web-shell-permission-panel]').first().innerText()).replace(/\s+/g, ' ').slice(0, 160);
    const d = `card text=${j(head)}`;
    if (arm === 'head') R.check(`${tag} R1-7 fixed: the Harness's own call title reaches the card`, head.includes('RIG-TITLE-13107'), d);
    else R.check(`${tag} before: the title is dropped and the card falls back to the tool name`, !head.includes('RIG-TITLE-13107'), d);
    await shot(ui.page, `s14-g-${arm}`);
    await ui.context.close();
    R.note(`${tag} cleanup`, j(await finish(S)));
  }
}
await browser.close();
R.done();
process.exit(0);
