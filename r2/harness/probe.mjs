// PR #12250 real-daemon probe.  ARM=head|mut node probe.mjs <window|retain> [tag]
//
// A real `qwen serve` daemon, a real ACP child, and a scripted model.  The
// model makes the parent launch one background agent; when it finishes, the
// child admits an automatic background-notification turn (`_qwencode/start_turn`)
// whose first step is a silent 20 s shell call.  That is the probe window.
//
//  window: inside the window, POST branch / rewind / fork / cd / mid-turn
//          message; after the turn ends, the same four operations as a control.
//  retain: inside the window, drop the SSE subscription and detach the only
//          client; watch whether the reaper (500 ms / 1 s idle) keeps the
//          session until the background turn ends.
import fs from 'node:fs';

const env = process.env;
const ARM = env.ARM;
const BASE = env.BASE_URL;
const TOKEN = env.TOKEN;
const MOCK = `http://127.0.0.1:${env.MOCK_PORT}`;
const WS = env.WS;
const scenario = process.argv[2];
const tag = process.argv[3] || 'r1';
const label = `${ARM}-${scenario}-${tag}`;
const T0 = Date.now();
const rel = (t = Date.now()) => +((t - T0) / 1000).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const actions = [];
const sse = [];
const act = (m, extra) => {
  actions.push({ t: rel(), m, ...(extra || {}) });
  console.log(`[${label} +${rel()}s] ${m}`, extra ? JSON.stringify(extra).slice(0, 400) : '');
};
process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection', e?.message ?? e);
  process.exit(3);
});

async function api(path, { method = 'GET', body, clientId } = {}) {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(clientId ? { 'x-qwen-client-id': clientId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text: text.slice(0, 800), ms: Date.now() - t };
}
const mockLog = async () => (await fetch(`${MOCK}/__log`)).json();

function subscribe(sid, clientId) {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/session/${sid}/events`, {
        headers: { Authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream', 'x-qwen-client-id': clientId },
        signal: ac.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let ev;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          const upd = ev?.data?.update;
          sse.push({
            t: rel(),
            type: ev.type,
            promptId: ev.promptId,
            su: upd?.sessionUpdate,
            bgTurn: upd?._meta?.backgroundTurn?.turnId,
            ...(ev.type === 'mid_turn_message_injected' ? { injected: ev.data } : {}),
            text: (upd?.content?.text ?? '').replace(/\s+/g, ' ').slice(0, 80) || undefined,
          });
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) sse.push({ t: rel(), type: 'sse-error', text: String(e).slice(0, 120) });
    }
  })();
  return () => ac.abort();
}

async function until(pred, timeoutMs, what, everyMs = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await pred();
    if (v) return v;
    await sleep(everyMs);
  }
  act(`TIMEOUT waiting for ${what}`);
  return undefined;
}
const liveIds = async () => {
  const r = await api(`/workspaces/${encodeURIComponent(WS)}/sessions/live-state`);
  return (r.json?.sessions ?? []).map((s) => s.sessionId);
};
const summary = (st) => ({
  http: st.status,
  hasActivePrompt: st.json?.hasActivePrompt,
  backgroundTurn: st.json?.backgroundTurn?.turnId,
  cwd: st.json?.workspaceCwd ?? st.json?.cwd,
});

fs.mkdirSync(`${env.R}/out/runs`, { recursive: true });
await fetch(`${MOCK}/__run`, { method: 'POST', body: JSON.stringify({ label }) });
const created = await api('/session', { method: 'POST', body: { cwd: WS, approvalMode: 'yolo', sessionScope: 'thread' } });
if (created.status >= 300) throw new Error(`POST /session ${created.status} ${created.text}`);
const sid = created.json.sessionId;
const clientId = created.json.clientId;
act('session created', { sid, clientId });
let unsub = subscribe(sid, clientId);
await sleep(500);

const p = await api(`/session/${sid}/prompt`, {
  method: 'POST',
  clientId,
  body: { prompt: [{ type: 'text', text: '[[S:bgwin]] launch alpha in the background' }] },
});
act(`POST /prompt -> ${p.status}`, { ms: p.ms, body: p.json ?? p.text });

// the automatic background-notification turn is admitted and its silent shell call is running
const bgStatus = await until(async () => {
  const st = await api(`/session/${sid}/status`);
  return st.json?.backgroundTurn ? st : undefined;
}, 40000, 'backgroundTurn on /status');
await until(async () => (await mockLog()).find((r) => r.kind === 'parent' && r.notifs.includes('Alpha probe') && r.ended), 10000, 'notification turn tool call');
await sleep(700);
const bgTurn = bgStatus?.json?.backgroundTurn;
act('background turn admitted', { status: summary(bgStatus), backgroundTurn: bgTurn });
const userPromptId = sse.find((e) => e.promptId && e.promptId !== bgTurn?.turnId)?.promptId;
act('parent user prompt id (from SSE)', { userPromptId });

// the child only accepts `<sessionId>########<n>`; any well-formed id gets past
// its format check, so a 409 here can only come from a busy guard
const rewindTarget = `${sid}########0`;
const daemonLog = `${env.R}/out/daemon-${ARM}.log`;
const probeLines = () =>
  fs.existsSync(daemonLog)
    ? fs.readFileSync(daemonLog, 'utf8').split('\n').filter((l) => l.startsWith('[probe-') && l.includes(sid))
    : [];
const linesAtStart = probeLines().length;
const result = { label, arm: ARM, scenario, sid, clientId, backgroundTurn: bgTurn, userPromptId, window: {}, control: {}, retain: undefined };

async function ops(slot) {
  const out = {};
  out.branch = await api(`/session/${sid}/branch`, { method: 'POST', clientId, body: {} });
  out.rewind = await api(`/session/${sid}/rewind`, { method: 'POST', clientId, body: { promptId: rewindTarget, rewindFiles: false } });
  out.fork = await api(`/session/${sid}/fork`, { method: 'POST', clientId, body: { directive: 'review this' } });
  out.cd = await api(`/session/${sid}/cd`, { method: 'POST', clientId, body: { path: `${WS}/sub` } });
  for (const [k, v] of Object.entries(out)) {
    act(`${slot}: POST ${k} -> ${v.status}`, { ms: v.ms, code: v.json?.code, body: v.json ?? v.text });
  }
  return out;
}

if (scenario === 'window') {
  const before = await api(`/session/${sid}/status`);
  const w = await ops('window');
  const mid = await api(`/session/${sid}/mid-turn-message`, { method: 'POST', clientId, body: { message: '[[MID]] also note this while the background turn runs' } });
  act(`window: POST mid-turn-message -> ${mid.status}`, { body: mid.json ?? mid.text });
  const after = await api(`/session/${sid}/status`);
  result.window = { statusBefore: summary(before), statusAfter: summary(after), ...w, midTurn: mid };
  await sleep(300);
  result.window.probeLines = probeLines().slice(linesAtStart);
  act('window: daemon [probe-*] lines', { lines: result.window.probeLines });
  // let the background turn finish
  await until(async () => {
    const st = await api(`/session/${sid}/status`);
    const log = await mockLog();
    const inflight = log.filter((r) => !r.ended && !r.aborted).length;
    return !st.json?.backgroundTurn && !st.json?.hasActivePrompt && inflight === 0 ? st : undefined;
  }, 60000, 'background turn end', 200);
  await sleep(1500);
  act('background turn finished', { status: summary(await api(`/session/${sid}/status`)) });
  result.injected = sse.filter((e) => e.type === 'mid_turn_message_injected');
  act('mid_turn_message_injected frames', { frames: result.injected.map((e) => ({ promptId: e.promptId, messages: e.injected?.messages })) });
  // control: the same operations once the session is idle
  const c = {};
  c.cd = await api(`/session/${sid}/cd`, { method: 'POST', clientId, body: { path: `${WS}/sub` } });
  act(`control: POST cd -> ${c.cd.status}`, { body: c.cd.json ?? c.cd.text });
  c.cdBack = await api(`/session/${sid}/cd`, { method: 'POST', clientId, body: { path: WS } });
  act(`control: POST cd back -> ${c.cdBack.status}`, { body: c.cdBack.json ?? c.cdBack.text });
  c.branch = await api(`/session/${sid}/branch`, { method: 'POST', clientId, body: {} });
  act(`control: POST branch -> ${c.branch.status}`, { body: c.branch.json ?? c.branch.text });
  c.rewind = await api(`/session/${sid}/rewind`, { method: 'POST', clientId, body: { promptId: rewindTarget, rewindFiles: false } });
  act(`control: POST rewind -> ${c.rewind.status}`, { body: c.rewind.json ?? c.rewind.text });
  // fork last: the fork agent is itself background work and would re-arm the guards
  c.fork = await api(`/session/${sid}/fork`, { method: 'POST', clientId, body: { directive: 'review this' } });
  act(`control: POST fork -> ${c.fork.status}`, { body: c.fork.json ?? c.fork.text });
  await until(async () => {
    const st = await api(`/session/${sid}/status`);
    return st.json?.backgroundTurn ? st : undefined;
  }, 15000, 'fork agent notification turn', 150);
  const forkBusy = await api(`/session/${sid}/branch`, { method: 'POST', clientId, body: {} });
  act(`control: branch while the fork's own notification turn runs -> ${forkBusy.status}`, { code: forkBusy.json?.code });
  c.forkBusyBranch = forkBusy;
  await sleep(300);
  c.probeLinesAll = probeLines().slice(linesAtStart);
  act('all daemon [probe-*] lines for this session', { lines: c.probeLinesAll });
  result.control = c;
} else if (scenario === 'cdonly' || scenario === 'forkonly') {
  // one operation alone inside the window: its latency, its answer, and what
  // the session looks like while the caller is still waiting
  const op = scenario === 'cdonly' ? 'cd' : 'fork';
  const t0 = Date.now();
  const pending = op === 'cd'
    ? api(`/session/${sid}/cd`, { method: 'POST', clientId, body: { path: `${WS}/sub` } })
    : api(`/session/${sid}/fork`, { method: 'POST', clientId, body: { directive: 'review this' } });
  let settled;
  pending.then((r) => (settled = { ...r, at: rel() }));
  const timeline = [];
  let lastKey = '';
  while (Date.now() - t0 < 45000) {
    const st = await api(`/session/${sid}/status`);
    const log = await mockLog();
    const row = {
      cwd: st.json?.workspaceCwd,
      backgroundTurn: st.json?.backgroundTurn?.turnId?.slice(-12),
      firstBgTurnDone: log.some((r) => r.kind === 'parent' && /BG-TURN-DONE/.test(String(r.reply)) && r.ended),
      mockRequests: log.length,
      opAnswered: settled ? settled.status : null,
    };
    const key = JSON.stringify(row);
    if (key !== lastKey) {
      timeline.push({ t: rel(), ...row });
      act(`${op}only: change`, row);
      lastKey = key;
    }
    if (settled && row.firstBgTurnDone && Date.now() - t0 > 3000) break;
    await sleep(250);
  }
  result.single = { op, sentAt: +((t0 - T0) / 1000).toFixed(2), answer: settled, timeline };
  act(`${op}only: answer`, { status: settled?.status, at: settled?.at, ms: settled?.ms, body: settled?.json ?? settled?.text });
  await sleep(300);
  result.single.probeLines = probeLines().slice(linesAtStart);
  act(`${op}only: daemon [probe-*] lines`, { lines: result.single.probeLines });
} else if (scenario === 'retain' || scenario === 'retainx' || scenario === 'retainw') {
  unsub();
  unsub = () => {};
  await sleep(300);
  const d = await api(`/session/${sid}/detach`, { method: 'POST', clientId });
  act(`POST detach -> ${d.status}`, { body: d.text });
  // retainx: a client comes back 1.5 s later, while the background turn is still running
  let reattach;
  if (scenario === 'retainw') {
    // re-attach 0.5 s after the daemon's first conditional close for this session
    // during the turn; if none is sent within 12 s of the detach, re-attach then
    const dlog = `${env.R}/out/daemon-${ARM}.log`;
    const tD = Date.now();
    let sendSeenAt;
    while (Date.now() - tD < 12000) {
      const hit = fs.readFileSync(dlog, 'utf8').split('\n').find((l) => l.startsWith('[probe-close-if-unheld-send]') && l.includes(sid) && !l.includes('"backgroundTurn":null'));
      if (hit) { sendSeenAt = rel(); break; }
      await sleep(50);
    }
    if (sendSeenAt !== undefined) await sleep(500);
    const r = await api(`/session/${sid}/load`, { method: 'POST', body: { cwd: WS } });
    reattach = { sendSeenAt: sendSeenAt ?? null, status: r.status, ms: r.ms, at: rel(), code: r.json?.code, body: r.json ?? r.text };
    act(`retainw: POST load (re-attach) -> ${r.status}`, reattach);
  }
  if (scenario === 'retainx') {
    await sleep(Number(env.REATTACH_MS || 1500));
    const r = await api(`/session/${sid}/load`, { method: 'POST', body: { cwd: WS } });
    reattach = { status: r.status, ms: r.ms, at: rel(), code: r.json?.code, body: r.json ?? r.text };
    act(`retainx: POST load (re-attach) -> ${r.status}`, reattach);
  }
  const timeline = [];
  let lastKey = '';
  let goneAt;
  let bgEndAt;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const ids = await liveIds();
    const log = await mockLog();
    const bgDone = log.some((r) => r.kind === 'parent' && /BG-TURN-DONE/.test(String(r.reply)) && r.ended);
    if (bgDone && bgEndAt === undefined) bgEndAt = rel();
    const row = { present: ids.includes(sid), bgTurnDone: bgDone };
    const key = JSON.stringify(row);
    if (key !== lastKey) {
      timeline.push({ t: rel(), ...row });
      act('retain: change', row);
      lastKey = key;
    }
    if (!row.present && goneAt === undefined) goneAt = rel();
    if (goneAt !== undefined && Date.now() - t0 > 2000) break;
    if ((scenario === 'retainx' || scenario === 'retainw') && bgEndAt !== undefined && rel() - bgEndAt > 6) break;
    await sleep(250);
  }
  const final = await api(`/session/${sid}/status`);
  result.retain = { reattach, detach: d.status, detachedAt: actions.find((a) => a.m.startsWith('POST detach'))?.t, timeline, goneAt, bgEndAt, finalStatus: final.status };
  act('retain: result', { goneAt, bgEndAt, finalStatus: final.status });
}

unsub();
await sleep(200);
result.actions = actions;
result.sse = sse;
result.mock = (await mockLog()).map(({ freshUserExcerpts, ...r }) => ({ ...r, freshUserExcerpts: freshUserExcerpts?.map((x) => x.slice(0, 200)) }));
fs.writeFileSync(`${env.R}/out/runs/${label}.json`, JSON.stringify(result, null, 1));
act('saved', { file: `out/runs/${label}.json` });
process.exit(0);
