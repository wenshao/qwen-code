// Error-path and content-negotiation probes against a real Spring server
// (embedded Tomcat + MySQL). Run the same script against both arms.
//   node probe-errors.mjs <baseUrl> <arm> <out.jsonl>
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [base, arm, out] = process.argv.slice(2);
const A = `rig-${arm}-a-${randomUUID().slice(0, 6)}`;
const B = `rig-${arm}-b-${randomUUID().slice(0, 6)}`;
const WS = '/api/agent/web-shell/v1';
const PUB = '/v1/agents/sessions';
fs.writeFileSync(out, '');

async function call(id, method, path, { tenant = A, accept, body, headers = {}, contentType, raw } = {}) {
  const h = { ...headers };
  if (tenant) h['X-Qwen-Tenant-Id'] = tenant;
  if (accept) h.accept = accept;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    h['content-type'] = contentType ?? 'text/plain';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['content-type'] = contentType ?? 'application/json';
  }
  const reqId = h['X-Request-Id'];
  const t0 = Date.now();
  const res = await fetch(base + path, { method, headers: h, body: payload });
  let text = '';
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('event-stream')) {
    // Read only the first frame of a live stream.
    const reader = res.body.getReader();
    const { value } = await reader.read();
    text = new TextDecoder().decode(value ?? new Uint8Array());
    reader.cancel().catch(() => {});
  } else {
    text = await res.text();
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const entry = {
    id,
    arm,
    method,
    path,
    accept: accept ?? '(default */*)',
    sentRequestId: reqId ?? null,
    status: res.status,
    contentType: ct,
    xRequestId: res.headers.get('x-request-id'),
    body: json ?? (text.length ? text.slice(0, 200) : ''),
    ms: Date.now() - t0,
  };
  fs.appendFileSync(out, JSON.stringify(entry) + '\n');
  const code = json?.error?.code ?? (text.length ? `<${text.length}B non-JSON>` : '<empty>');
  const rid = json?.error ? ` request_id=${json.error.request_id ?? 'MISSING'}` : '';
  console.log(`${id.padEnd(4)} ${method.padEnd(6)} ${String(res.status).padEnd(4)} ${ct.padEnd(32)} ${code}${rid} xrid=${entry.xRequestId}`);
  return { res, json, entry };
}

// Setup: one public Session and one WebShell Session in tenant A.
const pub = await call('S1', 'POST', PUB, {
  body: { agent_id: 'rig-agent', input: [] },
  headers: { 'Idempotency-Key': `k-${randomUUID()}` },
});
const sid = pub.json.id;
const ws = await call('S2', 'POST', `${WS}/sessions/create`, {
  body: { idempotencyKey: `k-${randomUUID()}`, agentId: 'rig-agent', input: [] },
});
const wsid = ws.json?.sessionId ?? ws.json?.session?.sessionId;

// SSE-only Accept on the stream routes (the defect the PR fixes).
await call('E1', 'POST', `${WS}/events/stream`, { tenant: B, accept: 'text/event-stream', body: { sessionId: wsid }, headers: { 'X-Request-Id': 'probe-E1' } });
await call('E2', 'POST', `${WS}/events/stream`, { accept: 'text/event-stream', body: { sessionId: '' }, headers: { 'X-Request-Id': 'probe-E2' } });
await call('E3', 'GET', `${PUB}/${sid}/events`, { tenant: B, accept: 'text/event-stream', headers: { 'X-Request-Id': 'probe-E3' } });
await call('E4', 'GET', `${PUB}/${sid}/events?limit=0`, { accept: 'text/event-stream', headers: { 'X-Request-Id': 'probe-E4' } });
// Same foreign reads with a JSON-compatible Accept (control).
await call('E5', 'POST', `${WS}/events/stream`, { tenant: B, accept: 'text/event-stream, application/json', body: { sessionId: wsid }, headers: { 'X-Request-Id': 'probe-E5' } });
await call('E6', 'GET', `${PUB}/${sid}/events`, { tenant: B, accept: 'application/json', headers: { 'X-Request-Id': 'probe-E6' } });

// Non-JSON Accept on JSON-only routes (side effect of presetting the type?).
await call('N1', 'GET', `${PUB}/${sid}`, { accept: 'text/event-stream', headers: { 'X-Request-Id': 'probe-N1' } });
await call('N2', 'GET', `${PUB}/${sid}`, { accept: 'text/html', headers: { 'X-Request-Id': 'probe-N2' } });
await call('N3', 'GET', `${PUB}/sess_missing_${randomUUID().slice(0, 8)}`, { accept: 'text/html', headers: { 'X-Request-Id': 'probe-N3' } });
await call('N4', 'POST', `${WS}/sessions/get`, { accept: 'text/event-stream', body: { sessionId: wsid }, headers: { 'X-Request-Id': 'probe-N4' } });

// Framework-level client errors.
await call('F1', 'PUT', `${PUB}/${sid}`, { body: {}, headers: { 'X-Request-Id': 'probe-F1' } });
await call('F2', 'POST', PUB, { raw: 'hello', contentType: 'text/plain', headers: { 'Idempotency-Key': 'k-f2', 'X-Request-Id': 'probe-F2' } });
await call('F3', 'GET', '/v1/agents/nope', { headers: { 'X-Request-Id': 'probe-F3' } });
await call('F4', 'GET', PUB, { tenant: null, headers: { 'X-Request-Id': 'probe-F4' } });
await call('F5', 'POST', PUB, { raw: '{not json', contentType: 'application/json', headers: { 'Idempotency-Key': 'k-f5', 'X-Request-Id': 'probe-F5' } });
await call('F6', 'GET', `${PUB}/${sid}`, { tenant: B, headers: { 'X-Request-Id': 'probe-F6' } });
console.log(JSON.stringify({ arm, tenantA: A, tenantB: B, publicSession: sid, webShellSession: wsid }));
