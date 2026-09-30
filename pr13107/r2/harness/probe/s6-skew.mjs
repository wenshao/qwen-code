// VERIFICATION RIG ONLY (PR #13107): how often the page re-reads the Action list while an approval waits,
// with the browser clock in step with the service and with the browser clock ahead of the Action's expiry.
// usage: DB=<db> node s6-skew.mjs [observeSeconds]
import { createSession, ensureWorkspace, waitPending, waitTurn, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, card, calls, option } from './ui.mjs';
assertIdle();
const R = new Report('s6-skew');
const observe = Number(process.argv[2] ?? 12) * 1000;
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('web', WS, `UI_WRITE name=s6-${Date.now().toString(36)}.txt content=skew`);
const p = await waitPending(c.session, { surface: 'web' });
const ttl = p.action.expiresAt - Date.now();
const browser = await launch();
const inStep = await open(browser, { arm: 'head', session: c.session });
const ahead = await open(browser, { arm: 'head', session: c.session, skewMs: ttl + 15 * 60_000 });
await Promise.all([waitCard(inStep.page), waitCard(ahead.page)]);
const a0 = calls(inStep.net, '/actions/query').length;
const b0 = calls(ahead.net, '/actions/query').length;
await sleep(observe);
const a = calls(inStep.net, '/actions/query').length - a0;
const b = calls(ahead.net, '/actions/query').length - b0;
R.check(`browser clock in step: no actions/query while the approval waits (${observe / 1000} s)`, a === 0, `${a} calls`);
R.check('browser clock ahead of the expiry: the card is still shown (the service decides expiry)', (await card(ahead.page).count()) === 1, '');
R.note(`browser clock ahead of the expiry: actions/query calls in ${observe / 1000} s`, `${b} calls (${(b / (observe / 1000)).toFixed(2)}/s)`);
R.check('browser clock ahead: the page does not re-read the list in a loop', b <= 2, `${b} calls in ${observe / 1000} s`);
await option(inStep.page, 'deny').click();
const g = await waitNoCard(ahead.page);
R.check('answer from the in-step page: both pages drop the card', g.ok, `${g.ms} ms`);
const t = await waitTurn(c.session);
R.check('Turn completes', t.status === 'COMPLETED', t.status);
await browser.close();
R.done();
process.exit(0);
