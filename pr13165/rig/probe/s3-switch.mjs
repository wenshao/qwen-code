// VERIFICATION RIG ONLY (PR #13165): the real 403 lands while bob is looking at a different Session.
// The latch must go to the Session the answer was aimed at (G), not the one selected when it lands (H).
// usage: DB=<db> node s3-switch.mjs <head|base>
import { createSession, listActions, waitPending, waitTurn, readWs, Report, sleep, j, one, written, sql, TENANT, register, respond as apiRespond } from './lib.mjs';
import { launch, open, waitCard, shot, card, calls, option } from './ui.mjs';

const [arm = 'head'] = process.argv.slice(2);
const HEAD = arm === 'head';
const R = new Report(`s3-switch-${arm}`);
for (const [ws, st, creators, readers] of [['ws-a', 'st-a', ['alice', 'carol'], ['bob']], ['ws-b', 'st-b', ['bob', 'alice'], []]]) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`) === '0') register(ws, st, { creators, readers });
}
const busy = sql(`SELECT t.session_id FROM managed_agent_turn t JOIN managed_agent_session s ON s.session_id = t.session_id WHERE s.workspace_id IN ('ws-a','ws-b') AND t.status NOT IN ('COMPLETED','FAILED','CANCELLED')`);
if (busy.length) { console.error('RIG BUSY'); process.exit(2); }
const tag = `${arm}-${Date.now().toString(36)}`;
const state = (page) => card(page).locator('[data-option-id]').evaluateAll((els) => els.map((el) => el.disabled));
const reason = (page) => page.evaluate(() => [...document.querySelectorAll('p.text-destructive[role="alert"], p.text-destructive[role="status"]')].map((p) => `${p.getAttribute('role')}: ${p.textContent.trim()}`));
const select = (page, s) => page.evaluate((id) => window.__rig.select(id), s);
const responds = (net, s) => calls(net, '/actions/respond').filter((e) => e.req?.sessionId === s);

const G = await createSession('web', 'ws-a', `UI_WRITE name=fg-${tag}.txt content=alice-g delay=4000`, { actor: 'alice' });
const H = await createSession('web', 'ws-b', `UI_WRITE name=fh-${tag}.txt content=bob-h delay=4000`, { actor: 'bob' });
R.check('alice creates G (ws-a), bob creates H (ws-b)', G.status === 202 && H.status === 202, `G=${G.session} H=${H.session}`);
const pg = await waitPending(G.session, { surface: 'web', actor: 'alice', timeoutMs: 45_000 });
const ph = await waitPending(H.session, { surface: 'web', actor: 'bob', timeoutMs: 45_000 });
R.check('both Sessions have a pending approval', !pg.timeout && !ph.timeout, `${pg.ms} ms / ${ph.ms} ms`);
const browser = await launch();
const ui = await open(browser, { arm, actor: 'bob', session: G.session });
let release;
const gate = new Promise((r) => (release = r));
let n = 0;
await ui.page.route('**/api/agent/web-shell/v1/actions/respond', async (route) => {
  if (n++ === 0) await gate;
  return route.continue();
});
R.check('bob sees G\'s card', (await waitCard(ui.page, { timeoutMs: 20_000 })).ok);
await sleep(500);
await option(ui.page, 'allow').click();
await sleep(300);
await select(ui.page, H.session);
await waitCard(ui.page, { timeoutMs: 20_000 });
await sleep(800);
release();
const t0 = Date.now();
while (!responds(ui.net, G.session).length && Date.now() - t0 < 10_000) await sleep(100);
await sleep(1500);
const g403 = responds(ui.net, G.session)[0];
R.check('the held G answer lands while H is selected: real 403 action_forbidden', g403?.status === 403 && g403?.res?.error?.code === 'action_forbidden', j({ status: g403?.status, code: g403?.res?.error?.code }));
const hState = await state(ui.page);
const hReason = await reason(ui.page);
await shot(ui.page, `s3-${arm}-on-h`);
R.check('H (bob\'s own Session) stays answerable and shows no reason', hState.length >= 2 && hState.every((d) => !d) && hReason.length === 0, j({ hState, hReason }));
await option(ui.page, 'allow').click();
const t1 = Date.now();
while (!responds(ui.net, H.session).length && Date.now() - t1 < 10_000) await sleep(100);
R.check('bob answers H: 202', responds(ui.net, H.session)[0]?.status === 202, j(responds(ui.net, H.session).map((e) => e.status)));
const th = await waitTurn(H.session, { timeoutMs: 60_000 });
R.check('H completes, file written', th.status === 'COMPLETED' && readWs('b', `child/fh-${tag}.txt`) === written('bob-h'), th.status);
await select(ui.page, G.session);
await waitCard(ui.page, { timeoutMs: 20_000 });
await sleep(1500);
const gState = await state(ui.page);
const gReason = await reason(ui.page);
await shot(ui.page, `s3-${arm}-back-on-g`);
if (HEAD) R.check('head: back on G the card is disabled and states the creator-only reason (role=status)', gState.every((d) => d) && gReason.length === 1 && gReason[0].startsWith('status: Only the Session creator'), j({ gState, gReason }));
else R.check('base: back on G the card is enabled and states nothing', gState.every((d) => !d) && gReason.length === 0, j({ gState, gReason }));
const g1 = (await listActions('web', G.session, { actor: 'alice' })).json.data?.find((a) => a.state === 'requested');
await apiRespond('web', G.session, g1, 'allow', { actor: 'alice', key: `alice-${g1.actionId}` });
const tg = await waitTurn(G.session, { timeoutMs: 60_000 });
R.check('alice answers G and it completes', tg.status === 'COMPLETED', tg.status);
R.note('console errors', j(ui.consoleErrors));
await browser.close();
R.done();
process.exit(0);
