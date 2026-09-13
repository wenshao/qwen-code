// ARM=pr|base node ui-steer.mjs [tag]
// A user types into the real Web Shell composer while an automatic
// continuation (idle parent, returned background result) is running.
import * as O from './obs.mjs';
import * as U from './ui.mjs';

const tag = process.argv[2] || 'r1';
const label = `${O.ARM}-steer-${tag}`;
const STEER = '[[STEER]] please also mention the release note';
const NEEDLES = ['STEER-ACK', STEER, 'HANDLED[Alpha probe]', 'PARENT-DONE steer'];
const out = { label, arm: O.ARM, facts: {}, shots: [], steps: [] };
const step = (m, x) => {
  out.steps.push({ t: Date.now(), m, ...(x || {}) });
  console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 400) : '');
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
const capture = async (key, name, full = false) => {
  await page.waitForTimeout(300);
  out.facts[key] = { t: Date.now(), ...(await U.facts(page, sid, NEEDLES)) };
  out.shots.push(await U.shot(page, `${O.ARM}-steer-${name}`, { fullPage: full }));
  step(key, out.facts[key]);
};

await U.send(page, '[[S:steer]] launch alpha in the background');
await waitMock((l) => l.find((r) => r.kind === 'parent' && r.notifs.includes('Alpha probe')), 40000, 'alpha continuation');
await page.waitForTimeout(2500);
const st = (await O.api(`/session/${sid}/status`)).json;
step('daemon status during continuation', { hasActivePrompt: st?.hasActivePrompt, backgroundTurn: st?.backgroundTurn?.turnId });
await capture('beforeSend', '1-continuation-running');

await U.send(page, STEER);
step('steering message typed + Enter');
await page.waitForTimeout(1500);
await capture('afterSend', '2-after-send');

// settle: no in-flight model request for 6s, daemon idle
let lastSig = '';
let lastChange = Date.now();
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  const log = await O.mockLog();
  const s2 = (await O.api(`/session/${sid}/status`)).json ?? {};
  const inFlight = log.filter((r) => !r.ended && !r.aborted).length;
  const sig = `${log.length}:${inFlight}:${sse.length}:${s2.hasActivePrompt}`;
  if (sig !== lastSig) {
    lastSig = sig;
    lastChange = Date.now();
  }
  if (!s2.hasActivePrompt && inFlight === 0 && Date.now() - lastChange > 6000) break;
  await O.sleep(250);
}
await page.waitForTimeout(1000);
await capture('final', '3-final', true);

unsub();
unpoll();
out.net = net;
out.errors = errors;
out.sse = sse;
out.polls = polls;
out.mock = await O.mockLog();
out.pending = (await O.api(`/session/${sid}/pending-prompts`)).json;
O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/63de0ea4-4d44-4577-a263-66b150608516/scratchpad/h/out/runs/${label}.json`, { ...out, T0: O.T0, actions: out.steps.map((x) => ({ t: x.t, m: x.m })) });
step('saved', { net });
await browser.close();
process.exit(0);
