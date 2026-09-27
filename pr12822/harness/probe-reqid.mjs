// X-Request-Id and agent_revision probes against a real Spring server.
//   node probe-reqid.mjs <baseUrl> <arm> <out.jsonl>
import fs from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const [base, arm, out] = process.argv.slice(2);
const A = `rig-${arm}-rid-${randomUUID().slice(0, 6)}`;
const B = `${A}-other`;
const WS = '/api/agent/web-shell/v1';
const PUB = '/v1/agents/sessions';
fs.writeFileSync(out, '');

// Raw http.request so header bytes (spaces, UTF-8) are sent as-is.
function raw(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, insecureHTTPParser: true }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function call(id, what, method, path, { tenant = A, header, body, headers = {} } = {}) {
  const h = { 'X-Qwen-Tenant-Id': tenant, accept: 'application/json', ...headers };
  if (header !== undefined) h['X-Request-Id'] = header;
  let payload;
  if (body !== undefined) {
    payload = Buffer.from(JSON.stringify(body));
    h['content-type'] = 'application/json';
    h['content-length'] = payload.length;
  }
  const res = await raw(method, path, h, payload);
  let json = null;
  try {
    json = JSON.parse(res.text);
  } catch {}
  const xrid = res.headers['x-request-id'] ?? null;
  const envelope = json?.error?.request_id;
  const entry = { id, what, status: res.status, sentHeader: header ?? null, bodyRequestId: body?.requestId ?? null, xRequestId: xrid, envelopeRequestId: envelope ?? null, code: json?.error?.code ?? null, body: json };
  fs.appendFileSync(out, JSON.stringify(entry) + '\n');
  const shown = (v) => (v == null ? 'null' : v.length > 40 ? `${v.slice(0, 18)}…(${v.length})` : v);
  console.log(`${id.padEnd(4)} ${String(res.status).padEnd(4)} ${what.padEnd(58)} x-request-id=${shown(xrid)}${envelope !== undefined ? ` request_id=${shown(envelope)}` : ''}${json?.error ? ` code=${json.error.code}` : ''}`);
  return { json, xrid };
}
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v ?? '');

const s = await call('R0', 'setup public session', 'POST', PUB, { body: { agent_id: 'rig-agent', input: [] }, headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
const sid = s.json.id;
await call('R1', 'valid header kept', 'GET', `${PUB}/${sid}`, { header: 'trace-abc_123.XYZ' });
await call('R2', 'header with a space -> generated', 'GET', `${PUB}/${sid}`, { header: 'a b' });
await call('R3', 'header of 128 visible chars kept', 'GET', `${PUB}/${sid}`, { header: 'x'.repeat(128) });
await call('R4', 'header of 129 chars -> generated', 'GET', `${PUB}/${sid}`, { header: 'x'.repeat(129) });
await call('R5', 'header with UTF-8 bytes -> generated', 'GET', `${PUB}/${sid}`, { header: Buffer.from('trace-é', 'utf8').toString('latin1') });
await call('R6', 'no header -> generated UUID', 'GET', `${PUB}/${sid}`);
await call('R7', '404 envelope request_id == header', 'GET', `${PUB}/${sid}`, { tenant: B, header: 'trace-r7' });
await call('R8', 'invalid tenant (filter) envelope', 'GET', PUB, { tenant: 'bad tenant!', header: 'trace-r8' });

const k9 = `k-${randomUUID()}`;
const ws = await call('R9', 'WS create: body requestId replaces header', 'POST', `${WS}/sessions/create`, { header: 'hdr-r9', body: { requestId: 'body-r9', idempotencyKey: k9, agentId: 'rig-agent', input: [] } });
const wsid = ws.json.sessionId;
await call('R10', 'WS create: unsafe body requestId ignored', 'POST', `${WS}/sessions/create`, { header: 'hdr-r10', body: { requestId: 'has space', idempotencyKey: `k-${randomUUID()}`, agentId: 'rig-agent', input: [] } });
await call('R11', 'WS create: 129-char body requestId', 'POST', `${WS}/sessions/create`, { header: 'hdr-r11', body: { requestId: 'y'.repeat(129), idempotencyKey: `k-${randomUUID()}`, agentId: 'rig-agent', input: [] } });
await call('R12', 'WS create: invalid body (no idempotencyKey)', 'POST', `${WS}/sessions/create`, { header: 'hdr-r12', body: { requestId: 'body-r12', agentId: 'rig-agent', input: [] } });
await call('R13', 'WS submit foreign session: body id echoed', 'POST', `${WS}/turns/submit`, { tenant: B, header: 'hdr-r13', body: { requestId: 'body-r13', idempotencyKey: `k-${randomUUID()}`, sessionId: wsid, input: [{ type: 'input_text', text: 'x' }] } });
await call('R14', 'WS create replay (same key): body id echoed', 'POST', `${WS}/sessions/create`, { header: 'hdr-r14', body: { requestId: 'body-r14', idempotencyKey: k9, agentId: 'rig-agent', input: [] } });
await call('R15', 'WS get: body requestId not used (query route)', 'POST', `${WS}/sessions/get`, { header: 'hdr-r15', body: { sessionId: wsid, requestId: 'body-r15' } });

// agent_revision on public create.
await call('V1', 'create naming the configured revision "1"', 'POST', PUB, { body: { agent_id: 'rig-agent', agent_revision: '1', input: [] }, headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
await call('V2', 'create naming revision "2"', 'POST', PUB, { header: 'trace-v2', body: { agent_id: 'rig-agent', agent_revision: '2', input: [] }, headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
await call('V3', 'create naming revision ""', 'POST', PUB, { body: { agent_id: 'rig-agent', agent_revision: '', input: [] }, headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
await call('V4', 'create naming revision null', 'POST', PUB, { body: { agent_id: 'rig-agent', agent_revision: null, input: [] }, headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
const kv = `k-${randomUUID()}`;
await call('V5', 'create without revision, key K', 'POST', PUB, { body: { agent_id: 'rig-agent', input: [] }, headers: { 'Idempotency-Key': kv } });
await call('V6', 'replay key K naming revision "1"', 'POST', PUB, { body: { agent_id: 'rig-agent', agent_revision: '1', input: [] }, headers: { 'Idempotency-Key': kv } });
console.log(JSON.stringify({ arm, tenant: A, sid, wsid, uuidR2: 'see jsonl' }));
const rows = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const id of ['R2', 'R4', 'R5', 'R6']) {
  const r = rows.find((x) => x.id === id);
  console.log(`${id} generated id is a UUID: ${isUuid(r.xRequestId)}`);
}
