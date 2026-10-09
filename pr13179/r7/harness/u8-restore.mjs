// VERIFICATION RIG ONLY (PR #13179 round 6): shape (g) — a terminal stream verdict that a keep-alive already expired,
// then the (healthy, long-lived) stream connection ends with a network error. Does the old verdict come back?
// One 404 on a stream reconnect; the next connection is healthy and idle (keep-alives clear the line); at T_BLIP the
// browser goes offline for OFFLINE_MS (the open stream fails with a network error), then online again.
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, setWireRules, killStreams, wirePort } from './lib.mjs';
const DIRECT = process.env.DIRECT === '1';
import { launch, open, alertText, shot, sleep } from './ui.mjs';
const ARMS = (process.env.ARMS ?? 'base,prev,head').split(',');
const T_BLIP = Number(process.env.T_BLIP ?? 40), OFFLINE_MS = Number(process.env.OFFLINE_MS ?? 3000);
const r = new Report('u8-restore');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'UI_STREAM n=3 delay=20 tag=RST');
r.check('turn completed', (await waitTurn(c.session)).status === 'COMPLETED');
const b = await launch();
const pages = [];
for (const arm of ARMS) pages.push({ ...(await open(b, { arm, session: c.session, ...(DIRECT ? { api: `http://127.0.0.1:${wirePort(arm)}` } : {}) })), log: [] });
for (const p of pages) await p.page.getByText('[RST-0003]').first().waitFor({ timeout: 30_000 });
await sleep(8000);
for (const arm of ARMS) setWireRules(arm, [{ kind: 'status', path: '/events/stream$', status: 404, code: 'session_not_found', times: 1 }]);
for (const arm of ARMS) await killStreams(arm);
const t0 = Date.now();
let blipped = false;
for (let k = 0; k < 2 * (T_BLIP + 45); k++) {
  const s = (Date.now() - t0) / 1000;
  if (!blipped && s >= T_BLIP) {
    blipped = true;
    if (DIRECT) {
      // the healthy, long-lived stream connection is dropped abruptly (network error in the browser)
      for (const arm of ARMS) r.note(`${arm}: streams dropped abruptly`, String(await (await fetch(`http://127.0.0.1:${wirePort(arm)}/__wire/kill`, { method: 'POST', body: JSON.stringify({ mode: 'destroy' }) })).json().then((x) => x.killed)));
    } else {
      r.note('offline', `at ${s.toFixed(1)} s for ${OFFLINE_MS} ms`);
      await Promise.all(pages.map((p) => p.context.setOffline(true)));
      await sleep(OFFLINE_MS);
      await Promise.all(pages.map((p) => p.context.setOffline(false)));
    }
  }
  for (const p of pages) p.log.push({ s: +((Date.now() - t0) / 1000).toFixed(1), alerts: await alertText(p.page) });
  if (blipped && !globalThis.__shot && (Date.now() - t0) / 1000 >= T_BLIP + 3) { globalThis.__shot = true; for (const p of pages) await shot(p.page, `u8-${p.arm}-3s-after-drop`); }
  await sleep(500);
}
for (const p of pages) await shot(p.page, `u8-${p.arm}-end`);
for (const p of pages) {
  const before = p.log.filter((x) => x.s >= T_BLIP - 5 && x.s < T_BLIP).at(-1)?.alerts;
  const after = p.log.filter((x) => x.s > T_BLIP);
  const shown = [...new Set(after.flatMap((x) => x.alerts))];
  const visible = after.filter((x) => x.alerts.length);
  const streamFails = p.net.filter((e) => e.path === '/events/stream' && e.t >= t0).map((e) => `${((e.t - t0) / 1000).toFixed(1)}s:${e.status ?? e.failed ?? 'open'}`);
  r.say(`ROW ${JSON.stringify({ arm: p.arm, alertsJustBeforeBlip: before, alertTextsAfterBlip: shown, visibleAfterBlipS: visible.length ? [visible[0].s, visible.at(-1).s] : null, endAlerts: p.log.at(-1).alerts, streams: streamFails })}`);
}
for (const arm of ARMS) setWireRules(arm, []);
await b.close();
r.done({ session: c.session });
