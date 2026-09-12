// ARM=pr|base node ui-reload.mjs [tag]
// Reload the real Web Shell while an automatic continuation is running: does
// the tab recover "running" from live/load, and settle when it ends?
import * as O from './obs.mjs';
import * as U from './ui.mjs';

const tag = process.argv[2] || 'r1';
const label = `${O.ARM}-reload-${tag}`;
const NEEDLES = ['HANDLED[Alpha probe]', 'PARENT-DONE steer', 'Processing Alpha probe results'];
const out = { label, arm: O.ARM, facts: {}, shots: [], steps: [] };
const step = (m, x) => {
  out.steps.push({ t: Date.now(), m, ...(x || {}) });
  console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 500) : '');
};
const waitMock = async (pred, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = pred(await O.mockLog());
    if (hit) return hit;
    await O.sleep(150);
  }
  step(`TIMEOUT ${what}`);
};
const notif = (l) => l.find((r) => r.kind === 'parent' && r.notifs.includes('Alpha probe'));

await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId;
out.sid = sid;
const sse = [];
const polls = [];
const unsub = O.subscribe(sid, s.clientId, sse);
const unpoll = O.poll(sid, polls);
const { browser, page, errors } = await U.open(sid);
step('web shell open', { sid });
const capture = async (key, name, full = false) => {
  await page.waitForTimeout(300);
  out.facts[key] = { t: Date.now(), ...(await U.facts(page, sid, NEEDLES)) };
  out.shots.push(await U.shot(page, `${O.ARM}-reload-${name}`, { fullPage: full }));
  step(key, out.facts[key]);
};

await U.send(page, '[[S:steer]] launch alpha in the background');
await waitMock(notif, 40000, 'alpha continuation');
await page.waitForTimeout(2000);
await capture('beforeReload', '1-before-reload');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 30000 });
await page.waitForTimeout(3000);
const st = (await O.api(`/session/${sid}/status`)).json;
step('daemon status after reload', { hasActivePrompt: st?.hasActivePrompt, backgroundTurn: st?.backgroundTurn?.turnId });
await capture('afterReload', '2-after-reload');

await waitMock((l) => {
  const r = notif(l);
  return r && (r.ended || r.aborted) ? r : undefined;
}, 40000, 'continuation end');
await page.waitForTimeout(3500);
await capture('settled', '3-settled');

unsub();
unpoll();
out.errors = errors;
out.sse = sse;
out.polls = polls;
out.mock = await O.mockLog();
O.save(`/root/git/h11636/out/runs/${label}.json`, { ...out, T0: O.T0, actions: out.steps.map((x) => ({ t: x.t, m: x.m })) });
step('saved');
await browser.close();
process.exit(0);
