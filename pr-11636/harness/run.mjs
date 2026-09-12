// ARM=pr|base node run.mjs <scenario> [tag]
// REST-only driver: real daemon, real ACP child, scripted model.
import * as O from './obs.mjs';

const scenario = process.argv[2];
const tag = process.argv[3] || 'r1';
const label = `${O.ARM}-${scenario}-${tag}`;
const sse = [];
const polls = [];
const actions = [];
const act = (m, extra) => {
  actions.push({ t: Date.now(), m, ...(extra || {}) });
  console.log(`[${label} +${O.rel()}s]`, m, extra ? JSON.stringify(extra).slice(0, 300) : '');
};

async function waitFor(pred, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const log = await O.mockLog();
    const hit = pred(log);
    if (hit) return hit;
    await O.sleep(150);
  }
  act(`TIMEOUT waiting for ${what}`);
  return undefined;
}
async function waitQuiet(sid, quietMs, timeoutMs) {
  const t0 = Date.now();
  let lastCount = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const log = await O.mockLog();
    const st = (await O.api(`/session/${sid}/status`)).json ?? {};
    const sig = `${log.length}:${log.filter((r) => r.ended || r.aborted).length}:${sse.length}:${st.hasActivePrompt}`;
    if (sig !== lastCount) {
      lastCount = sig;
      lastChange = Date.now();
    }
    // The daemon's own idle verdict is exactly what is under test, so it cannot
    // be the only stop signal: also require that no model request is in flight.
    const inFlight = log.filter((r) => !r.ended && !r.aborted).length;
    if (!st.hasActivePrompt && inFlight === 0 && Date.now() - lastChange > quietMs) return true;
    await O.sleep(200);
  }
  act('TIMEOUT waiting for quiet');
  return false;
}
const notifReq = (desc) => (log) => log.find((r) => r.kind === 'parent' && r.notifs.includes(desc));
const subEnded = (name) => (log) => log.find((r) => r.kind === 'sub' && r.sub?.[0] === name && r.ended);

await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId;
const clientId = s.clientId;
act('session created', { sid, clientId });
const unsub = O.subscribe(sid, clientId, sse);
const unpoll = O.poll(sid, polls);
await O.sleep(800);

const P = (text) => O.prompt(sid, clientId, text).then((r) => (act(`POST /prompt -> ${r.status}`, { text, body: r.json ?? r.text }), r));

switch (scenario) {
  case 'idle': {
    await P('[[S:idle]] launch alpha in the background');
    await waitFor(notifReq('Alpha probe'), 40000, 'alpha notification request');
    await waitQuiet(sid, 4000, 60000);
    break;
  }
  case 'same': {
    await P('[[S:same]] launch alpha then run a silent shell wait');
    await waitQuiet(sid, 5000, 60000);
    break;
  }
  case 'stop': {
    await P('[[S:stop]] launch alpha and beta');
    await waitFor(notifReq('Alpha probe'), 40000, 'alpha automatic continuation');
    act('alpha continuation started at the model');
    await waitFor(subEnded('beta'), 30000, 'beta subagent finished');
    await O.sleep(1500);
    const pend = await O.api(`/session/${sid}/pending-prompts`);
    act('pending-prompts before cancel', { body: pend.json });
    const c = await O.api(`/session/${sid}/cancel`, { method: 'POST', clientId, body: {} });
    act(`POST /cancel -> ${c.status}`, { body: c.text });
    await O.sleep(12000);
    const log1 = await O.mockLog();
    act('12s after cancel', { betaDelivered: !!notifReq('Beta probe')(log1) });
    await P('[[S:after]] a new user prompt after stop');
    await waitQuiet(sid, 8000, 60000);
    break;
  }
  case 'reststeer': {
    await P('[[S:steer]] launch alpha');
    await waitFor(notifReq('Alpha probe'), 40000, 'alpha automatic continuation');
    await O.sleep(3000);
    const st = (await O.api(`/session/${sid}/status`)).json;
    act('status during continuation', { hasActivePrompt: st?.hasActivePrompt, bg: st?.backgroundTurn?.turnId });
    await P('[[STEER]] user message sent during the automatic continuation');
    await waitQuiet(sid, 6000, 60000);
    break;
  }
  case 'overflow': {
    await P('[[S:overflow]] launch 21 agents then wait');
    await waitQuiet(sid, 8000, 120000);
    break;
  }
  case 'overflowb': {
    await P('[[S:overflowb]] launch 21 slow agents then run one silent wait');
    await waitQuiet(sid, 8000, 180000);
    break;
  }
  default:
    throw new Error(`unknown scenario ${scenario}`);
}

unsub();
unpoll();
await O.sleep(300);
const log = await O.mockLog();
const tr = await O.api(`/session/${sid}/turn-index`);
const pend = await O.api(`/session/${sid}/pending-prompts`);
O.save(`/root/git/h11636/out/runs/${label}.json`, {
  label,
  arm: O.ARM,
  scenario,
  sid,
  T0: O.T0,
  actions,
  polls,
  sse,
  mock: log.map(({ freshUserExcerpts, ...r }) => ({ ...r, freshUserExcerpts: freshUserExcerpts?.map((x) => x.slice(0, 160)) })),
  turnIndex: tr.json,
  pendingPrompts: pend.json,
});
act('saved', { file: `out/runs/${label}.json`, mockRequests: log.length, sse: sse.length, polls: polls.length });
process.exit(0);
