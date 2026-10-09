// VERIFICATION RIG ONLY (PR #13179 round 7): the re-arm bound (MAX_SESSION_REARMS = 3) on the real stack.
// The page is opened while the watched Session's summary read (sessions/get) answers 404 on every other request
// (one of two round-robin replicas does not serve the Session) for FAULT_S seconds; then the backend is healthy.
// Per arm: what the panel shows during the fault, after it heals, whether a new turn run after the heal is rendered
// without user action, and what the Refresh button does.
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, setWireRules, submit, wireEntries } from './lib.mjs';
import { launch, open, alertText, shot, sleep } from './ui.mjs';
const ARMS = (process.env.ARMS ?? 'base,prev,head').split(',');
const FAULT_S = Number(process.env.FAULT_S ?? 30);
const HEALED_S = Number(process.env.HEALED_S ?? 30);
const RUN_TAG = process.env.RUN_TAG ?? '1';
const r = new Report(`u9-rearm-${RUN_TAG}`);
ensureWorkspace(WS, `st-${ST}`);
const tag = `RA${RUN_TAG}`;
const c = await createSession('public', WS, `UI_STREAM n=3 delay=20 tag=${tag}`);
r.check('turn 1 completed', (await waitTurn(c.session)).status === 'COMPLETED');
const rule = [{ kind: 'status', path: '/sessions/get$', bodyContains: c.session, status: 404, code: 'session_not_found', every: 2 }];
for (const arm of ARMS) setWireRules(arm, rule);
await sleep(300);
const b = await launch();
const pages = [];
const t0 = Date.now();
for (const arm of ARMS) pages.push({ ...(await open(b, { arm, session: c.session })), log: [] });
const sec = () => +((Date.now() - t0) / 1000).toFixed(1);
const sample = async () => {
  for (const p of pages)
    p.log.push({ s: sec(), alerts: await alertText(p.page), t1: await p.page.getByText(`[${tag}-0003]`).count(), t2: await p.page.getByText(`[${tag}N-0003]`).count() });
};
while (sec() < FAULT_S) { await sample(); await sleep(500); }
for (const p of pages) await shot(p.page, `u9-${RUN_TAG}-${p.arm}-end-of-fault`);
for (const arm of ARMS) setWireRules(arm, []);
const tHeal = sec();
r.note('fault cleared at', `${tHeal} s`);
while (sec() < tHeal + HEALED_S) { await sample(); await sleep(500); }
const sub = await submit(c.session, `UI_STREAM n=3 delay=20 tag=${tag}N`);
const t2 = await waitTurn(c.session, { timeoutMs: 60_000 });
r.note('turn 2 (run after the heal)', `${sub.status} ${j(t2)} at ${sec()} s`);
const tTurn2 = sec();
for (let k = 0; k < 20; k++) { await sample(); await sleep(500); }
for (const p of pages) await shot(p.page, `u9-${RUN_TAG}-${p.arm}-after-turn2`);
const before = {};
for (const p of pages) before[p.arm] = { alerts: await alertText(p.page), turn2: (await p.page.getByText(`[${tag}N-0003]`).count()) > 0 };
const tRefresh = sec();
for (const p of pages) await p.page.getByRole('button', { name: 'Refresh', exact: true }).click();
await sleep(8000);
for (const p of pages) await shot(p.page, `u9-${RUN_TAG}-${p.arm}-after-refresh`);
for (const p of pages) {
  const w = wireEntries(p.arm);
  const reqs = p.net.filter((e) => e.t !== undefined);
  const during = (path, a, z) => reqs.filter((e) => e.path === path && (e.t - t0) / 1000 >= a && (e.t - t0) / 1000 < z).length;
  const alertWindows = [];
  for (const x of p.log) {
    const key = x.alerts.join(' | ');
    const last = alertWindows.at(-1);
    if (last && last.alerts === key) last.to = x.s;
    else alertWindows.push({ alerts: key, from: x.s, to: x.s });
  }
  const row = {
    arm: p.arm,
    injected: w.filter((e) => e.kind === 'res' && e.injected).length,
    faultS: tHeal,
    duringFault: { sessionsGet: during('/sessions/get', 0, tHeal), transcriptQuery: during('/transcript/query', 0, tHeal), streamOpens: during('/events/stream', 0, tHeal) },
    afterHeal: { sessionsGet: during('/sessions/get', tHeal, tRefresh), transcriptQuery: during('/transcript/query', tHeal, tRefresh), streamOpens: during('/events/stream', tHeal, tRefresh) },
    bootstrapsAtS: reqs.filter((e) => e.path === '/transcript/query').map((e) => +((e.t - t0) / 1000).toFixed(1)),
    turn1RenderedAtS: p.log.find((x) => x.t1 > 0)?.s ?? null,
    turn2RenderedAtS: p.log.find((x) => x.t2 > 0)?.s ?? null,
    turn2RunAtS: tTurn2,
    alertWindows: alertWindows.filter((x) => x.alerts).map((x) => `${x.from}-${x.to}s: ${x.alerts}`),
    beforeRefresh: before[p.arm],
    afterRefresh: { alerts: await alertText(p.page), turn2: (await p.page.getByText(`[${tag}N-0003]`).count()) > 0, transcriptQuery: during('/transcript/query', tRefresh, Infinity) },
  };
  r.say(`ROW ${JSON.stringify(row)}`);
}
await b.close();
r.done({ session: c.session });
