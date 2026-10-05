// VERIFICATION RIG ONLY (PR #13179 round 4): shape (d) — one failed "Older history" page fetch on a live Session.
// Needs raw paging: Spring on its own DB with the materializer off (events.materialize-interval=24h), so the
// bootstrap transcript (limit 100) carries an older cursor. Each arm's wire fails exactly ONE paged
// transcript/query (the request carrying "cursor") with STATUS, then everything is healthy.
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, setWireRules, submit, snapshotCovered, lastSeq } from './lib.mjs';
import { launch, open, alertText, shot, sleep } from './ui.mjs';
const ARMS = (process.env.ARMS ?? 'base,prev,head').split(',');
const STATUS = Number(process.env.STATUS ?? 404);
const N = 160;
const r = new Report(`u7-page-${STATUS}`);
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, `UI_STREAM n=${N} delay=0 para=1 tag=PG`);
r.check('turn 1 completed', (await waitTurn(c.session, { timeoutMs: 90_000 })).status === 'COMPLETED', c.session);
await sleep(1000);
r.check('raw transcript path (no snapshot)', snapshotCovered(c.session) === 0, `lastSequence=${lastSeq(c.session)}`);
async function scrollTop(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-message-row-key]');
    let el = row?.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (!el) return false;
    el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); return true;
  });
}
const b = await launch();
const pages = [];
for (const arm of ARMS) pages.push({ ...(await open(b, { arm, session: c.session })), log: [] });
for (const p of pages) await p.page.getByText(`[PG-0${N}]`).first().waitFor({ timeout: 30_000 });
await sleep(3000);
const paged = (p) => p.net.filter((e) => e.path === '/transcript/query').length;
for (const p of pages) p.before = paged(p);
for (const arm of ARMS) setWireRules(arm, [{ kind: 'status', path: '/transcript/query$', bodyContains: '"cursor"', status: STATUS, code: STATUS === 404 ? 'session_not_found' : 'internal_error', times: 1 }]);
for (const p of pages) r.note(`${p.arm}: scrolled to top`, String(await scrollTop(p.page)));
await sleep(4000);
const snap = async (label) => { for (const p of pages) { const a = await alertText(p.page); p.log.push({ label, alerts: a }); } };
await snap('4s after the failed page');
for (const p of pages) r.note(`${p.arm}: page fetches after scroll`, j(p.net.filter((e) => e.path === '/transcript/query').slice(p.before).map((e) => e.status)));
await sleep(16000);
await snap('20s after (polls succeeded meanwhile)');
const sub = await submit(c.session, 'UI_STREAM n=5 delay=20 tag=PGN');
r.note('turn 2', `${sub.status} ${j(await waitTurn(c.session, { timeoutMs: 60_000 }))}`);
await sleep(5000);
await snap('after turn 2 streamed live');
for (const p of pages) await shot(p.page, `u7-${STATUS}-${p.arm}-after-turn2`);
for (const p of pages) r.note(`${p.arm}: turn 2 rendered`, String(await p.page.getByText('[PGN-0005]').count() > 0));
for (const arm of ARMS) setWireRules(arm, []);
for (const p of pages) await scrollTop(p.page);
await sleep(4000);
await snap('after a later successful page');
for (const p of pages) r.say(`ROW ${JSON.stringify({ arm: p.arm, log: p.log })}`);
await b.close();
r.done({ session: c.session });
