// PR #12250 R3 real-daemon probe.  ARM=obs|adm node probe3.mjs <cdlong|cdshort> [tag]
//
// Real `qwen serve`, real ACP child, scripted model -- the real-stack twin of
// the new "queued cd" table.  After the user turn ends, the client sends a cd
// that the (instrumented) child holds for 12 s.  While it is in flight, the
// background agent finishes and the child's automatic background-notification
// turn is admitted.  Then branch, fork and rewind are sent, each with a 5 s
// client timeout.  cdlong: the turn outlives the held cd.  cdshort: the turn
// ends (~2 s) before the cd is released.
import fs from 'node:fs';
const env = process.env;
const ARM = env.ARM, BASE = env.BASE_URL, TOKEN = env.TOKEN, WS = env.WS;
const MOCK = `http://127.0.0.1:${env.MOCK_PORT}`;
const scn = process.argv[2];
const tag = process.argv[3] || 'r1';
const label = `${ARM}-${scn}-${tag}`;
const CLIENT_TIMEOUT_MS = 5000;
const T0 = Date.now();
const rel = (t = Date.now()) => +((t - T0) / 1000).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const actions = [];
const act = (m, extra) => {
  actions.push({ t: rel(), m, ...(extra || {}) });
  console.log(`[${label} +${rel()}s] ${m}`, extra ? JSON.stringify(extra).slice(0, 300) : '');
};
async function api(path, { method = 'GET', body, clientId, timeoutMs } = {}) {
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text: text.slice(0, 600), ms: Date.now() - t, at: rel() };
  } catch (e) {
    return { status: e?.name === 'TimeoutError' ? 'client-timeout' : 'error', error: String(e).slice(0, 200), ms: Date.now() - t, at: rel() };
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
if (created.status >= 300) throw new Error(`POST /session ${created.status} ${created.text}`);
const sid = created.json.sessionId, clientId = created.json.clientId;
act('session created', { sid });
const probeLines = () => logLines().filter((l) => l.startsWith('[probe-') && l.includes(sid));
const liveIds = async () => ((await api(`/workspaces/${encodeURIComponent(WS)}/sessions/live-state`)).json?.sessions ?? []).map((s) => s.sessionId);
const sessionsBefore = await liveIds();

// turn 1: a plain exchange, so turn 2 has a rewind snapshot to go back to
const p0 = await api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text: '[[S:hello]] first turn' }] } });
act(`POST /prompt (turn 1) -> ${p0.status}`);
await until(async () => (await mockLog()).find((r) => /HELLO-DONE/.test(String(r.reply)) && r.ended), 10000, 'turn 1 done');
await until(async () => { const st = await api(`/session/${sid}/status`); return st.json && !st.json.hasActivePrompt ? st : undefined; }, 10000, 'idle after turn 1');
const p = await api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text: `[[S:${scn}]] launch alpha in the background` }] } });
act(`POST /prompt -> ${p.status}`, { ms: p.ms });
await until(async () => (await mockLog()).find((r) => r.kind === 'parent' && /PARENT-DONE/.test(String(r.reply)) && r.ended), 20000, 'user turn done');
await until(async () => { const st = await api(`/session/${sid}/status`); return st.json && !st.json.hasActivePrompt && !st.json.backgroundTurn ? st : undefined; }, 10000, 'session idle after user turn');
act('user turn finished; alpha still running in the background');

// 1. the cd the child holds -- in flight before the background turn exists
const cdP = api(`/session/${sid}/cd`, { method: 'POST', clientId, body: { path: `${WS}/slowcd` } });
let cd; cdP.then((r) => { cd = r; act(`cd answered -> ${r.status}`, { ms: r.ms, body: r.json ?? r.text }); });
await until(async () => probeLines().some((l) => l.includes('[probe-dispatch] cd')), 5000, 'cd dispatched to child');
act('cd dispatched to the child and held there');

// 2. the automatic background-notification turn is admitted while the cd is in flight
const bg = await until(async () => { const st = await api(`/session/${sid}/status`); return st.json?.backgroundTurn ? st : undefined; }, 20000, 'backgroundTurn admitted');
act('background turn admitted while cd in flight', { backgroundTurn: bg?.json?.backgroundTurn?.turnId, cdAnswered: !!cd });
const cdStillInFlight = !cd;

// 3. branch / fork / rewind, each with a client timeout
// a REAL target: the child's id for this session's first user turn, so an
// executed rewind visibly truncates the history
const rewindTarget = `${sid}########2`;
const transcriptShape = async () => {
  const t = await api(`/session/${sid}/transcript`);
  const ev = t.json?.events ?? [];
  const users = ev.filter((e) => e.data?.sessionUpdate === 'user_message_chunk').map((e) => String(e.data?.content?.text ?? '').slice(0, 40));
  return { http: t.status, events: ev.length, userMessages: users.length, users };
};
const historyBefore = await transcriptShape();
act('history before the window', historyBefore);
const ops = await Promise.all([
  api(`/session/${sid}/branch`, { method: 'POST', clientId, body: {}, timeoutMs: CLIENT_TIMEOUT_MS }).then((r) => ['branch', r]),
  api(`/session/${sid}/fork`, { method: 'POST', clientId, body: { directive: 'review this' }, timeoutMs: CLIENT_TIMEOUT_MS }).then((r) => ['fork', r]),
  api(`/session/${sid}/rewind`, { method: 'POST', clientId, body: { promptId: rewindTarget, rewindFiles: false }, timeoutMs: CLIENT_TIMEOUT_MS }).then((r) => ['rewind', r]),
]);
const window = Object.fromEntries(ops);
for (const [k, v] of ops) act(`window: POST ${k} -> ${v.status}`, { ms: v.ms, code: v.json?.code, error: v.error });

// 4. let everything settle: the cd, the turn, and anything that was queued
await until(async () => cd, 30000, 'cd answer');
const turnEnd = await until(async () => { const st = await api(`/session/${sid}/status`); const log = await mockLog(); return !st.json?.backgroundTurn && log.some((r) => /BG-TURN-DONE/.test(String(r.reply)) && r.ended) ? rel() : undefined; }, 60000, 'background turn end', 200);
await sleep(4000);
const lines = probeLines();
const dispatched = (op) => lines.filter((l) => l.includes(`[probe-dispatch] ${op} ->`)).length;
const childLines = logLines().filter((l) => l.includes('[probe-child]') && l.includes(sid));
const sessionsAfter = await liveIds();
const historyAfter = await transcriptShape();
act('history after everything settled', historyAfter);
const result = {
  label, arm: ARM, scn, sid, cdStillInFlightAtAdmission: cdStillInFlight, turnEndAt: turnEnd,
  cd, window, historyBefore, historyAfter, rewindTarget,
  dispatchedToChild: { branch: dispatched('branch'), fork: dispatched('fork'), rewind: dispatched('rewind'), cd: dispatched('cd') },
  newSessions: sessionsAfter.filter((s) => !sessionsBefore.includes(s) && s !== sid).length,
  childLines, probeLines: lines, actions,
  mock: (await mockLog()).map(({ freshUserExcerpts, ...r }) => r),
};
act('dispatched to child after the window', result.dispatchedToChild);
act('extra live sessions', { n: result.newSessions });
fs.writeFileSync(`${env.R}/out/runs/${label}.json`, JSON.stringify(result, null, 1));
act('saved', { file: `out/runs/${label}.json` });
process.exit(0);
