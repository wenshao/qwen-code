// Drive one daemon turn over REST + SSE and print the terminal event's data.
// usage: node wire.mjs <baseUrl> <token> <cwd> <scen> <outJson>
import fs from 'node:fs';

const [base, token, cwd, scen, outFile] = process.argv.slice(2);
const auth = { authorization: `Bearer ${token}` };

const created = await fetch(`${base}/session`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd, sessionScope: 'thread' }),
});
const session = await created.json();
const sessionId = session.sessionId ?? session.id;
const clientId = session.clientId;
const h = { ...auth, 'x-qwen-client-id': clientId };

const ac = new AbortController();
const events = [];
const sseDone = (async () => {
  const res = await fetch(`${base}/session/${sessionId}/events`, {
    headers: { ...h, accept: 'text/event-stream' },
    signal: ac.signal,
  });
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data) continue;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      events.push(ev);
      if (ev.type === 'turn_error' || ev.type === 'turn_complete') return ev;
    }
  }
})();

await new Promise((r) => setTimeout(r, 300));
const p = await fetch(`${base}/session/${sessionId}/prompt`, {
  method: 'POST',
  headers: { ...h, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: [{ type: 'text', text: `SCEN=${scen} go` }] }),
});
const accepted = await p.json();
const terminal = await Promise.race([
  sseDone,
  new Promise((r) => setTimeout(() => r({ timeout: true }), 600000)),
]);
ac.abort();
const toolCalls = events.filter((e) => e.type === 'session_update' && e.data?.sessionUpdate === 'tool_call').length;
const out = { sessionId, promptStatus: p.status, accepted, toolCallEvents: toolCalls, terminal };
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ scen, sessionId, type: terminal?.type, data: terminal?.data }));
process.exit(0);
