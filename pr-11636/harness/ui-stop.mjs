// ARM=pr|base node ui-stop.mjs [tag]
// Stop an automatic continuation from the real Web Shell while a second
// background result is already queued; then send a new prompt.
import * as O from './obs.mjs';
import * as U from './ui.mjs';

const tag = process.argv[2] || 'r1';
const label = `${O.ARM}-uistop-${tag}`;
const NEEDLES = ['HANDLED[Alpha probe]', 'HANDLED[Beta probe]', 'AFTER-DONE', 'Beta probe', 'Processing Alpha probe results', 'Awaiting processing'];
const out = { label, arm: O.ARM, facts: {}, shots: [], steps: [] };
const step = (m, x) => {
  out.steps.push({ t: Date.now(), m, ...(x || {}) });
  console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 600) : '');
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
const notif = (d) => (l) => l.find((r) => r.kind === 'parent' && r.notifs.includes(d));

await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId;
out.sid = sid;
const sse = [];
const polls = [];
const unsub = O.subscribe(sid, s.clientId, sse);
const unpoll = O.poll(sid, polls);
const { browser, page, net, errors } = await U.open(sid);
step('web shell open', { sid });
const transcriptText = () => page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(-900));
const capture = async (key, name, full = false) => {
  await page.waitForTimeout(300);
  out.facts[key] = { t: Date.now(), ...(await U.facts(page, sid, NEEDLES)), tail: await transcriptText() };
  out.shots.push(await U.shot(page, `${O.ARM}-uistop-${name}`, { fullPage: full }));
  step(key, out.facts[key]);
};

await U.send(page, '[[S:stop]] launch alpha and beta in the background');
await waitMock(notif('Alpha probe'), 40000, 'alpha continuation');
await waitMock((l) => l.find((r) => r.kind === 'sub' && r.sub?.[0] === 'beta' && r.ended), 30000, 'beta finished');
await page.waitForTimeout(1500);
await capture('beforeStop', '1-before-stop');

await page.locator('.cm-content').click();
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
let cancelled = sse.some((e) => e.type === 'prompt_cancelled' || e.stopReason === 'cancelled');
if (!cancelled) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  cancelled = sse.some((e) => e.type === 'prompt_cancelled' || e.stopReason === 'cancelled');
}
step('Escape pressed in composer', { cancelledOnWire: cancelled, cancelRequests: net.filter((n) => /cancel/.test(n.url)) });
if (!cancelled) {
  const c = await O.api(`/session/${sid}/cancel`, { method: 'POST', clientId: s.clientId, body: {} });
  step(`fallback REST cancel -> ${c.status}`);
}
await page.waitForTimeout(8000);
out.betaDeliveredBeforeNewPrompt = !!notif('Beta probe')(await O.mockLog());
await capture('afterStop', '2-after-stop');

await U.send(page, '[[S:after]] a new user prompt after stop');
const t0 = Date.now();
let lastSig = '';
let lastChange = Date.now();
while (Date.now() - t0 < 60000) {
  const log = await O.mockLog();
  const st = (await O.api(`/session/${sid}/status`)).json ?? {};
  const inFlight = log.filter((r) => !r.ended && !r.aborted).length;
  const sig = `${log.length}:${inFlight}:${sse.length}:${st.hasActivePrompt}`;
  if (sig !== lastSig) {
    lastSig = sig;
    lastChange = Date.now();
  }
  if (!st.hasActivePrompt && inFlight === 0 && Date.now() - lastChange > 6000) break;
  await O.sleep(250);
}
out.betaDeliveredAfterNewPrompt = !!notif('Beta probe')(await O.mockLog());
await capture('final', '3-final', true);

unsub();
unpoll();
out.net = net;
out.errors = errors;
out.sse = sse;
out.polls = polls;
out.mock = await O.mockLog();
O.save(`/root/git/h11636/out/runs/${label}.json`, { ...out, T0: O.T0, actions: out.steps.map((x) => ({ t: x.t, m: x.m })) });
step('saved', { betaDeliveredBeforeNewPrompt: out.betaDeliveredBeforeNewPrompt, betaDeliveredAfterNewPrompt: out.betaDeliveredAfterNewPrompt });
await browser.close();
process.exit(0);
