// Seed a REAL qwen serve daemon with N real turns (fake model behind it).
// usage: node seed.mjs <daemonUrl> <token> <cwd> <turns> <label>
const [, , daemon, token, cwd, turnsArg, label] = process.argv;
const turns = Number(turnsArg);
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

function userText(i) {
  if (i === 5) return `Question #5: 请解释一下量子纠缠与退相干的区别`;
  if (i === 42) return `Question #42: where is the user-only-needle-PLUM mentioned?`;
  return `Question #${i}: tell me about topic-${i}`;
}

const created = await fetch(`${daemon}/session`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ cwd, sessionScope: 'thread' }),
});
if (!created.ok) throw new Error(`POST /session ${created.status} ${await created.text()}`);
const session = await created.json();
const sessionId = session.sessionId ?? session.id;
const clientId = session.clientId;
console.error(`session=${sessionId} client=${clientId}`);
const headers = { ...auth, 'x-qwen-client-id': clientId };

// One long-lived SSE stream; resolve per promptId.
const waiters = new Map();
const sse = await fetch(`${daemon}/session/${sessionId}/events`, { headers });
if (!sse.ok) throw new Error(`events ${sse.status}`);
(async () => {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of sse.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!data) continue;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      const type = ev.type ?? ev.event;
      if (type === 'turn_complete' || type === 'turn_error') {
        const pid = ev.promptId ?? ev.data?.promptId ?? ev.payload?.promptId;
        const w = waiters.get(pid) ?? [...waiters.values()][0];
        if (w) {
          waiters.delete(pid);
          w({ type, ev });
        }
      }
    }
  }
})().catch((e) => console.error('sse closed', e.message));

const t0 = Date.now();
for (let i = 1; i <= turns; i++) {
  const r = await fetch(`${daemon}/session/${sessionId}/prompt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: [{ type: 'text', text: userText(i) }] }),
  });
  if (r.status !== 202 && r.status !== 200) throw new Error(`prompt ${i}: ${r.status} ${await r.text()}`);
  const { promptId } = await r.json();
  const done = await new Promise((resolve, reject) => {
    waiters.set(promptId, resolve);
    setTimeout(() => reject(new Error(`turn ${i} timed out`)), 60000);
  });
  if (done.type !== 'turn_complete') throw new Error(`turn ${i}: ${JSON.stringify(done.ev).slice(0, 400)}`);
  if (i % 100 === 0) console.error(`  ${i}/${turns} turns  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
console.log(JSON.stringify({ label, sessionId, clientId, turns, seconds: (Date.now() - t0) / 1000 }));
process.exit(0);
