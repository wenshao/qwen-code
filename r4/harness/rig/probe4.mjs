// PR #12250 R4 real-daemon probe.  ARM=obs|m17|ur|m17ur node probe4.mjs [tag]
//
// Real `qwen serve`, real ACP child, scripted model.  The real-stack twin of
// the retention test's new assertion: a detached Session whose admitted
// background notification turn is running -- what does the daemon publish as
// `activeWorkState`, and which term answers?
//   1. user turn launches background agent alpha (1.5 s); the turn ends
//   2. the only client detaches (the fixture's "detached session")
//   3. alpha finishes; the child's automatic notification turn is admitted and
//      sits in a silent 20 s shell call, then answers
// A sampler polls GET /workspaces/:ws/sessions/live-state every 100 ms for the
// whole run; the bundle's [probe-aws] lines say, per projection during the
// background turn, whether the daemon-owned term or the child's report held.
import fs from 'node:fs';
const env = process.env;
const ARM = env.ARM, BASE = env.BASE_URL, TOKEN = env.TOKEN, WS = env.WS;
const MOCK = `http://127.0.0.1:${env.MOCK_PORT}`;
const tag = process.argv[2] || 'r1';
const label = `${ARM}-aws-${tag}`;
const T0 = Date.now();
const rel = (t = Date.now()) => +((t - T0) / 1000).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const actions = [];
const act = (m, extra) => {
  actions.push({ t: rel(), m, ...(extra || {}) });
  console.log(`[${label} +${rel()}s] ${m}`, extra ? JSON.stringify(extra).slice(0, 300) : '');
};
async function api(path, { method = 'GET', body, clientId } = {}) {
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text: text.slice(0, 600), ms: Date.now() - t };
  } catch (e) {
    return { status: 'error', error: String(e).slice(0, 200), ms: Date.now() - t };
  }
}
const mockLog = async () => (await fetch(`${MOCK}/__log`)).json();
async function until(pred, timeoutMs, what, everyMs = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const v = await pred(); if (v) return v; await sleep(everyMs); }
  act(`TIMEOUT waiting for ${what}`); return undefined;
}
const daemonLog = `${env.R}/out/daemon-${ARM}.log`;
const logLines = () => fs.readFileSync(daemonLog, 'utf8').split('\n');

fs.mkdirSync(`${env.R}/out/runs`, { recursive: true });
await fetch(`${MOCK}/__run`, { method: 'POST', body: JSON.stringify({ label }) });
const created = await api('/session', { method: 'POST', body: { cwd: WS, approvalMode: 'yolo', sessionScope: 'thread' } });
if (typeof created.status !== 'number' || created.status >= 300) throw new Error(`POST /session ${created.status} ${created.text}`);
const sid = created.json.sessionId, clientId = created.json.clientId;
act('session created', { sid });

// sampler: the published summary, every 100 ms, until stopped or the session is gone
const samples = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const t = rel();
    const r = await api(`/workspaces/${encodeURIComponent(WS)}/sessions/live-state`);
    const s = (r.json?.sessions ?? []).find((x) => x.sessionId === sid);
    samples.push(s
      ? { t, present: true, hasActivePrompt: s.hasActivePrompt, activeWorkState: s.activeWorkState ?? null, backgroundTurn: s.backgroundTurn?.turnId ?? null, hasRunningBackgroundTasks: s.hasRunningBackgroundTasks, clientCount: s.clientCount }
      : { t, present: false, http: r.status });
    await sleep(100);
  }
})();

const p = await api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text: '[[S:bgwin]] launch alpha in the background' }] } });
act(`POST /prompt -> ${p.status}`, { ms: p.ms });
await until(async () => (await mockLog()).find((r) => r.kind === 'parent' && /PARENT-DONE/.test(String(r.reply)) && r.ended), 20000, 'user turn done');
await until(async () => { const st = await api(`/session/${sid}/status`); return st.json && !st.json.hasActivePrompt && !st.json.backgroundTurn ? st : undefined; }, 10000, 'idle after user turn');
act('user turn finished; alpha still running in the background');

const d = await api(`/session/${sid}/detach`, { method: 'POST', clientId });
act(`POST detach -> ${d.status}`, { body: d.text });

const bgStart = await until(async () => samples.findLast((s) => s.backgroundTurn), 20000, 'backgroundTurn admitted');
act('background turn admitted (detached session)', { turn: bgStart?.backgroundTurn });
const bgEnd = await until(async () => {
  const log = await mockLog();
  const last = samples.at(-1);
  return log.some((r) => /BG-TURN-DONE/.test(String(r.reply)) && r.ended) && last && !last.backgroundTurn ? rel() : undefined;
}, 60000, 'background turn end', 200);
act('background turn ended', { at: bgEnd });
await sleep(4000);
sampling = false;
await sampler;

const aws = logLines().filter((l) => l.startsWith('[probe-aws] ') && l.includes(sid)).map((l) => JSON.parse(l.slice(12)));
const inTurn = samples.filter((s) => s.present && s.backgroundTurn);
const tally = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const result = {
  label, arm: ARM, sid, detach: d.status,
  duringBackgroundTurn: {
    samples: inTurn.length,
    firstAt: inTurn[0]?.t, lastAt: inTurn.at(-1)?.t,
    activeWorkState: tally(inTurn, (s) => s.activeWorkState),
    hasActivePrompt: tally(inTurn, (s) => s.hasActivePrompt),
    clientCount: tally(inTurn, (s) => s.clientCount),
  },
  projections: {
    n: aws.length,
    local: tally(aws, (a) => a.local),
    childReportsHeldWork: tally(aws, (a) => a.child),
    holdCategories: tally(aws, (a) => (a.holds ?? []).map((h) => h.category ?? h).sort().join('+') || '(none)'),
  },
  sessionGoneAt: samples.find((s, i) => !s.present && samples.slice(0, i).some((x) => x.present))?.t ?? null,
  samples, actions,
  mock: (await mockLog()).map(({ freshUserExcerpts, ...r }) => r),
};
act('during background turn', result.duringBackgroundTurn);
act('projections', result.projections);
fs.writeFileSync(`${env.R}/out/runs/${label}.json`, JSON.stringify(result, null, 1));
act('saved', { file: `out/runs/${label}.json` });
process.exit(0);
