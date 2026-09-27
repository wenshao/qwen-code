// Open a WebShell SSE stream with a known X-Request-Id, run a Turn, then
// delete the Session so the server completes the stream (async dispatch).
const base = process.argv[2];
const T = `rig-mdc-${Date.now().toString(36)}`;
const H = { 'X-Qwen-Tenant-Id': T, 'content-type': 'application/json' };
const post = (p, b, h = {}) => fetch(base + p, { method: 'POST', headers: { ...H, ...h }, body: JSON.stringify(b) }).then((r) => r.json());
const c = await post('/api/agent/web-shell/v1/sessions/create', { requestId: 'mdc-create', idempotencyKey: `k-${Date.now()}`, agentId: 'rig-agent', input: [] });
const sid = c.sessionId;
const res = await fetch(base + '/api/agent/web-shell/v1/events/stream', { method: 'POST', headers: { ...H, accept: 'text/event-stream', 'X-Request-Id': 'mdc-stream-1' }, body: JSON.stringify({ sessionId: sid, afterSequence: 0 }) });
console.log('stream', res.status, res.headers.get('x-request-id'));
let text = '';
const reader = res.body.getReader();
const pump = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } })();
await post('/api/agent/web-shell/v1/turns/submit', { requestId: 'mdc-submit', idempotencyKey: `k2-${Date.now()}`, sessionId: sid, input: [{ type: 'input_text', text: 'hello mdc' }] });
await new Promise((r) => setTimeout(r, 4000));
const del = await fetch(`${base}/v1/agents/sessions/${sid}`, { method: 'DELETE', headers: { 'X-Qwen-Tenant-Id': T, 'Idempotency-Key': `kd-${Date.now()}`, 'X-Request-Id': 'mdc-delete' } });
console.log('delete', del.status);
await Promise.race([pump, new Promise((r) => setTimeout(r, 5000))]);
console.log('events:', (text.match(/^event: ?.*$/gm) ?? []).join(' | '));
console.log(JSON.stringify({ tenant: T, sid }));
