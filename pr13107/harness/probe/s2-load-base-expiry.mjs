// VERIFICATION RIG ONLY (PR #13107): before/after on the same pending approval, then expiry.
// One Session waits on an approval. The PR-head page and the base (#13101 head) page both open it by URL
// (page-load path). Nobody answers; the approval expires.
// Needs the stack started with a short approval timeout (e.g. 30s).
// usage: DB=<db> node s2-load-base-expiry.mjs
import { ensureWorkspace, createSession, waitPending, waitTurn, readWs, executions, actionRow, finalText, Report, sleep, j, assertIdle , WS, ST } from './lib.mjs';
import { launch, open, waitCard, waitNoCard, shot, card, calls, text } from './ui.mjs';

assertIdle();
const R = new Report('s2-load-base-expiry');
ensureWorkspace(WS, `st-${ST}`);
const file = `s2-${Date.now().toString(36)}.txt`;
const c = await createSession('web', WS, `UI_WRITE name=${file} content=never-approved`);
const S = c.session;
const p = await waitPending(S, { surface: 'web' });
R.check('a Session is waiting on a requested approval before any page opens it', !p.timeout, `session=${S} action=${p.action?.actionId} timeout=${Math.round((p.action?.expiresAt - p.action?.createdAt) / 1000)} s`);
const A = p.action;
const browser = await launch();
const head = await open(browser, { arm: 'head', session: S });
const base = await open(browser, { arm: 'base', session: S });
const w = await waitCard(head.page, { timeoutMs: 20_000 });
R.check('HEAD page: the approval card is shown after a plain page load', w.ok, `after ${w.ms} ms; ${await text(card(head.page))}`);
await sleep(3000);
const baseText = (await base.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
R.check('BASE page: same Session, no approval card and no way to answer', (await card(base.page).count()) === 0 && !/allow once/i.test(baseText), baseText.slice(0, 400));
R.check('BASE page never asks the service for Actions', calls(base.net, '/actions/query').length === 0, `actions/query calls=${calls(base.net, '/actions/query').length}`);
await shot(head.page, 's2-head-pending');
await shot(base.page, 's2-base-pending');
const queriesWhilePending = calls(head.net, '/actions/query').length;

// nobody answers
const left = A.expiresAt - Date.now();
R.note('waiting for the approval to expire', `${Math.round(left / 1000)} s left`);
const gone = await waitNoCard(head.page, { timeoutMs: left + 30_000 });
const lag = Date.now() - A.expiresAt;
R.check('HEAD page: the card leaves once the approval has expired', gone.ok, `${lag} ms after expiresAt`);
const t = await waitTurn(S, { timeoutMs: 60_000 });
R.check('the Turn ends by itself after the expiry', ['COMPLETED', 'FAILED'].includes(t.status), `status=${t.status} ${t.error}`);
await sleep(2500);
R.check('Action is expired; the file was never written; no tool ran', actionRow(A.actionId)?.[0] === 'expired' && readWs(ST, `child/${file}`) === null && executions(S) === 0, `state=${actionRow(A.actionId)?.[0]} file=${readWs(ST, `child/${file}`)} executions=${executions(S)}`);
R.note('final assistant text', (await finalText(S)) ?? '');
const q = calls(head.net, '/actions/query');
R.note('HEAD page actions/query calls', `${queriesWhilePending} while pending (first ~${Math.round((Date.now() - q[0]?.t) / 1000)} s ago), ${q.length} in total`);
R.check('HEAD page does not poll the Action list while waiting', q.length <= 6, `total=${q.length}`);
R.check('no respond call was made by either page', calls(head.net, '/actions/respond').length === 0 && calls(base.net, '/actions/respond').length === 0, '');
await shot(head.page, 's2-head-expired');
await shot(base.page, 's2-base-expired');
R.note('console errors', j({ head: head.consoleErrors, base: base.consoleErrors }));
await browser.close();
R.done({ session: S, action: A.actionId });
process.exit(0);
