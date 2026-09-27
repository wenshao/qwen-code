// Open a stream and read it until the server ends it (short stream-timeout),
// then report what the client received after the last SSE frame.
//   node sse-timeout.mjs <baseUrl> <arm> <out.json>
import fs from 'node:fs';
const [base, arm, out] = process.argv.slice(2);
const T = `rig-sse-${arm}-${Date.now().toString(36)}`;
const H = { 'X-Qwen-Tenant-Id': T, 'content-type': 'application/json' };
const c = await fetch(`${base}/api/agent/web-shell/v1/sessions/create`, { method: 'POST', headers: H, body: JSON.stringify({ idempotencyKey: `k-${Date.now()}`, agentId: 'rig-agent', input: [] }) }).then((r) => r.json());
async function drain(label, url, init) {
  const t0 = Date.now();
  const res = await fetch(url, init);
  let text = '';
  const dec = new TextDecoder();
  try {
    for await (const chunk of res.body) text += dec.decode(chunk, { stream: true });
  } catch (e) {
    text += `\n<<client read error: ${e.message}>>`;
  }
  const frames = (text.match(/^event: ?[^\n]+$/gm) ?? []).length;
  const tailAfterFrames = text.replace(/^(?:(?:event|data|id|retry)[^\n]*\n|:[^\n]*\n|\n)*/m, '');
  const json = text.match(/\{"error"[^\n]*/);
  return { label, status: res.status, contentType: res.headers.get('content-type'), xRequestId: res.headers.get('x-request-id'), ms: Date.now() - t0, bytes: text.length, frames, appendedJson: json ? json[0].slice(0, 200) : null, lastBytes: JSON.stringify(text.slice(-160)) };
}
const results = [];
results.push(await drain('webshell stream', `${base}/api/agent/web-shell/v1/events/stream`, { method: 'POST', headers: { ...H, accept: 'text/event-stream', 'X-Request-Id': `sse-ws-${arm}` }, body: JSON.stringify({ sessionId: c.sessionId, afterSequence: 0 }) }));
results.push(await drain('public events', `${base}/v1/agents/sessions/${c.sessionId}/events`, { headers: { 'X-Qwen-Tenant-Id': T, accept: 'text/event-stream', 'X-Request-Id': `sse-pub-${arm}` } }));
fs.writeFileSync(out, JSON.stringify({ arm, tenant: T, sessionId: c.sessionId, results }, null, 1));
for (const r of results) console.log(`${arm.padEnd(5)} ${r.label.padEnd(16)} ${r.status} ${r.contentType} frames=${r.frames} ${r.ms}ms appendedJson=${r.appendedJson} last=${r.lastBytes}`);
