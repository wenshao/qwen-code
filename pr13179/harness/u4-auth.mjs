// VERIFICATION RIG ONLY (PR #13179): the gateway in front of the server starts answering 401 (an expired credential)
// for WATCH_S seconds, then accepts again. Injected at each arm's wire (the rig's Java server answers 404, never 401).
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, setWireRules } from './lib.mjs';
import { launch, open, alertText, shot, counts, gaps, sleep } from './ui.mjs';
const STATUS = Number(process.env.STATUS ?? 401), WATCH_S = Number(process.env.WATCH_S ?? 150);
const r = new Report(`u4-auth-${STATUS}`);
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'UI_STREAM n=3 delay=20 tag=AUT');
r.check('turn completed', (await waitTurn(c.session)).status === 'COMPLETED');
const b = await launch();
const pages = [];
for (const arm of ['base', 'head']) pages.push(await open(b, { arm, session: c.session }));
for (const p of pages) await p.page.getByText('[AUT-0003]').first().waitFor({ timeout: 30_000 });
await sleep(5000);
const rule = [{ kind: 'status', path: '^/api/agent/web-shell/v1/', status: STATUS, code: STATUS === 401 ? 'unauthenticated' : 'forbidden' }];
for (const arm of ['base', 'head']) setWireRules(arm, rule);
const tOn = Date.now();
// the open SSE stream is not affected by a rule installed later; end it the way a gateway re-auth would
for (const arm of ['base', 'head']) await fetch(`http://127.0.0.1:${arm === 'head' ? 19179 : 19180}/__wire/kill`, { method: 'POST', body: '{}' });
await sleep(WATCH_S * 1000);
for (const p of pages) await shot(p.page, `u4-${STATUS}-${p.arm}`);
for (const arm of ['base', 'head']) setWireRules(arm, []);
const tOff = Date.now();
await sleep(45_000);
for (const p of pages) {
  const during = p.net.filter((e) => e.t >= tOn && e.t < tOff);
  const back = p.net.find((e) => e.t >= tOff && e.path === '/events/stream' && e.status === 200);
  const row = { arm: p.arm, during: during.length, perMinute: +(during.length / ((tOff - tOn) / 60000)).toFixed(1), byPath: counts(during),
    lastDuringS: during.length ? +((during.at(-1).t - tOn) / 1000).toFixed(1) : null,
    streamGapsS: gaps(during.filter((e) => e.path === '/events/stream').map((e) => e.t)).map((g) => +(g / 1000).toFixed(1)),
    streamBackAfterS: back ? +((back.t - tOff) / 1000).toFixed(1) : null, alertsAfter: await alertText(p.page) };
  r.say(`ROW ${JSON.stringify(row)}`);
}
await b.close();
r.done({ session: c.session });
