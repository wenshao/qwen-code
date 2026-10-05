// VERIFICATION RIG ONLY (PR #13179 round 2): the two R7 Critical shapes on the real stack, three arms side by side:
// base = main, prev = previous head 07a9756 (⊕ main), head = e826f590 (⊕ main). Each arm has its own wire, so the
// injected answer is the server's own 404 body for exactly one sessions/get of that arm.
//  (a) live stream, ONE definite 404 on a summary poll, later polls succeed: does the red line retire?
//  (b) the bootstrap's own sessions/get gets that one 404 (terminal), later reads succeed: does the panel ever load?
//  (c) live stream, its reconnect gets ONE definite 404 (the stream is then healthy again and keeps delivering): does the red line retire?
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, setWireRules, submit, wireEntries, killStreams } from './lib.mjs';
import { launch, open, alertText, shot, sleep } from './ui.mjs';
const ARMS = (process.env.ARMS ?? 'base,prev,head').split(',');
const SHAPE = process.argv[2] ?? 'a';
const r = new Report(`u5-retire-${SHAPE}${process.env.CSTATUS ? '-' + process.env.CSTATUS : ''}`);
ensureWorkspace(WS, `st-${ST}`);
const tag = { a: 'RTA', b: 'RTB', c: 'RTC' }[SHAPE];
const c = await createSession('public', WS, `UI_STREAM n=3 delay=20 tag=${tag}`);
r.check('turn 1 completed', (await waitTurn(c.session)).status === 'COMPLETED');
const rule = [{ kind: 'status', path: SHAPE === 'c' ? '/events/stream$' : '/sessions/get$', status: Number(process.env.CSTATUS ?? 404), code: Number(process.env.CSTATUS ?? 404) === 404 ? 'session_not_found' : 'bad_gateway', times: 1 }];
const b = await launch();
const pages = [];
if (SHAPE === 'b') for (const arm of ARMS) setWireRules(arm, rule);
const t0 = Date.now();
for (const arm of ARMS) pages.push({ ...(await open(b, { arm, session: c.session })), log: [] });
if (SHAPE === 'a' || SHAPE === 'c') {
  for (const p of pages) await p.page.getByText(`[${tag}-0003]`).first().waitFor({ timeout: 30_000 });
  await sleep(8000);
  for (const arm of ARMS) setWireRules(arm, rule);
  // (c): end each arm's open stream in order, so its reconnect is the request that meets the one 404
  if (SHAPE === 'c') for (const arm of ARMS) r.note(`${arm}: streams ended`, String(await killStreams(arm)));
}
const tInj = Date.now();
const rendered = (p) => p.page.getByText(`[${tag}-0003]`).count();
for (let k = 0; k < 80; k++) {
  for (const p of pages) p.log.push({ s: +((Date.now() - tInj) / 1000).toFixed(1), alerts: await alertText(p.page), rendered: await rendered(p) });
  await sleep(500);
}
for (const p of pages) await shot(p.page, `u5${SHAPE}-${p.arm}-40s`);
const sub = await submit(c.session, `UI_STREAM n=3 delay=20 tag=${tag}N`);
const t2 = await waitTurn(c.session, { timeoutMs: 60_000 });
r.note('turn 2', `${sub.status} ${j(t2)}`);
await sleep(6000);
for (const p of pages) await shot(p.page, `u5${SHAPE}-${p.arm}-after-turn2`);
for (const p of pages) {
  const injected = wireEntries(p.arm).filter((e) => e.kind === 'res' && e.injected).length;
  const shown = p.log.filter((x) => x.alerts.length);
  const firstShown = shown[0]?.s ?? null;
  const lastShown = shown.at(-1)?.s ?? null;
  const firstRendered = p.log.find((x) => x.rendered > 0)?.s ?? null;
  const row = {
    arm: p.arm, injected404: injected,
    bannerFirstS: firstShown, bannerLastSeenS: lastShown, bannerAt40s: p.log.at(-1).alerts,
    transcriptRenderedAtS: firstRendered,
    streamOpens: p.net.filter((e) => e.path === '/events/stream' && e.t >= tInj).length,
    transcriptReads: p.net.filter((e) => e.path === '/transcript/query').length,
    turn2Rendered: await p.page.getByText(`[${tag}N-0003]`).count() > 0,
    alertsAfterTurn2: await alertText(p.page),
  };
  r.say(`ROW ${JSON.stringify(row)}`);
}
for (const arm of ARMS) setWireRules(arm, []);
await b.close();
r.done({ session: c.session });
