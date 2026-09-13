// ARM=head|pre node r14.mjs [tag]
// R1-4: a Live orchestrator waits on a thread (wait_threads). The thread's
// background result arrives while the thread is idle, so the daemon runs an
// automatic continuation and ends it with turn_complete{backgroundTurn}.
// Does the waiter wake, or does it hang until its timeout?
import fs from 'node:fs';
const ARM = process.env.ARM || 'head';
const P = ARM === 'pre'
  ? { port: 4657, mock: 18657, probe: 19657 }
  : { port: 4656, mock: 18656, probe: 19656 };
const H = new URL('.', import.meta.url).pathname;
const WS = `${H}pws-${ARM}`;
const BASE = `http://127.0.0.1:${P.port}`;
const TOKEN = 'T0KEN11636P';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const rel = (t = Date.now()) => ((t - T0) / 1000).toFixed(2);
const out = { arm: ARM, steps: [], sse: [], polls: [] };
const step = (m, x) => { out.steps.push({ t: Date.now(), rel: rel(), m, ...(x || {}) }); console.log(`[r14-${ARM} +${rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 400) : ''); };

async function api(path, { method = 'GET', body, clientId } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 400) };
}

function subscribe(sid, clientId, rows) {
  const ac = new AbortController();
  (async () => {
    const res = await fetch(`${BASE}/session/${sid}/events`, { headers: { Authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream', 'x-qwen-client-id': clientId }, signal: ac.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue; let ev; try { ev = JSON.parse(data); } catch { continue; }
        const upd = ev?.data?.update;
        rows.push({ rel: rel(), type: ev.type, su: upd?.sessionUpdate, promptId: ev.promptId ?? ev?.data?.promptId, bgTurn: ev?.data?.backgroundTurn?.turnId ?? upd?._meta?.backgroundTurn?.turnId, stopReason: ev?.data?.stopReason, text: (upd?.content?.text ?? '').replace(/\s+/g, ' ').slice(0, 70) || undefined });
      }
    }
  })().catch(() => {});
  return () => ac.abort();
}

await fetch(`http://127.0.0.1:${P.mock}/__run`, { method: 'POST', body: JSON.stringify({ label: `r14-${ARM}` }) });
const created = await api('/session', { method: 'POST', body: { cwd: WS, approvalMode: 'yolo', sessionScope: 'thread' } });
if (created.status >= 300) { console.error('create failed', created.text); process.exit(1); }
const sid = created.json.sessionId; const clientId = created.json.clientId;
out.sid = sid; step('session created', { sid });
const un = subscribe(sid, clientId, out.sse);

let stopPoll = false;
(async () => {
  let last = '';
  while (!stopPoll) {
    const st = (await api(`/session/${sid}/status`)).json ?? {};
    const tuple = { hasActivePrompt: st.hasActivePrompt, bg: st.backgroundTurn?.turnId?.slice(-24), activeWork: st.activeWorkState };
    const k = JSON.stringify(tuple);
    if (k !== last) { out.polls.push({ rel: rel(), ...tuple }); last = k; }
    await sleep(150);
  }
})();

await api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text: '[[S:idle]] launch the alpha probe in the background' }] } });
step('prompt sent');

// Wait for the automatic continuation to be the session's active execution.
let armed = false;
for (let i = 0; i < 300; i++) {
  const st = (await api(`/session/${sid}/status`)).json ?? {};
  if (st.hasActivePrompt === true && st.backgroundTurn?.turnId) { armed = true; step('background continuation active', { turnId: st.backgroundTurn.turnId }); break; }
  await sleep(120);
}
if (!armed) { step('NEVER SAW background continuation'); }

const waitStartedRel = rel();
const r = await fetch(`http://127.0.0.1:${P.probe}/wait`, { method: 'POST', body: JSON.stringify({ threadId: sid, timeoutMs: 25000 }) }).then((x) => x.json());
out.wait = { waitStartedRel, finishedRel: rel(), ...r };
step('wait_threads returned', { elapsedMs: r.elapsedMs, timedOut: r.result?.timedOut, wake: r.result?.wake, error: r.error });

// Control: an ORDINARY user turn. Both arms must wake on its turn_complete,
// so a pre-fix timeout below is specific to background terminals.
await sleep(2000);
await api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text: '[[S:slow]] answer slowly please' }] } });
step('control prompt sent');
let armed2 = false;
for (let i = 0; i < 200; i++) {
  const st = (await api(`/session/${sid}/status`)).json ?? {};
  if (st.hasActivePrompt === true) { armed2 = true; step('control prompt active'); break; }
  await sleep(100);
}
if (!armed2) step('NEVER SAW control prompt active');
const ctlStartedRel = rel();
const c = await fetch(`http://127.0.0.1:${P.probe}/wait`, { method: 'POST', body: JSON.stringify({ threadId: sid, timeoutMs: 25000 }) }).then((x) => x.json());
out.control = { ctlStartedRel, finishedRel: rel(), ...c };
step('control wait_threads returned', { elapsedMs: c.elapsedMs, timedOut: c.result?.timedOut, wake: c.result?.wake });

await sleep(1500);
stopPoll = true; un();
out.mock = await fetch(`http://127.0.0.1:${P.mock}/__log`).then((x) => x.json());
fs.mkdirSync(`${H}out/runs`, { recursive: true });
fs.writeFileSync(`${H}out/runs/r14-${ARM}.json`, JSON.stringify(out, null, 1));
step('saved');
process.exit(0);
