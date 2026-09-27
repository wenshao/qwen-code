// One Session read through both surfaces of the real server: which unit does each use?
const base = process.argv[2];
const H = { 'X-Qwen-Tenant-Id': 'tenant-ts-' + Date.now(), 'Content-Type': 'application/json', Accept: 'application/json' };
const t0 = Date.now();
const created = await (await fetch(base + '/v1/agents/sessions', { method: 'POST', headers: { ...H, 'Idempotency-Key': 'k-ts' }, body: JSON.stringify({ agent_id: 'qwen-code', input: [] }) })).json();
const id = created.id;
const pub = await (await fetch(`${base}/v1/agents/sessions/${id}`, { headers: H })).json();
const events = await (await fetch(`${base}/v1/agents/sessions/${id}/events`, { headers: H })).json();
const web = await (await fetch(`${base}/api/agent/web-shell/v1/sessions/get`, { method: 'POST', headers: H, body: JSON.stringify({ sessionId: id }) })).json();
const t1 = Date.now();
const unit = (v) => (v >= 1e12 ? 'epoch ms' : v >= 1e9 ? 'epoch s' : '?');
console.log(`client clock during probe: ${t0}..${t1} ms (${Math.floor(t0 / 1000)} s)`);
console.log(`session ${id}`);
console.log(`GET  /v1/agents/sessions/{id}          created_at = ${pub.created_at}  (${unit(pub.created_at)})`);
console.log(`GET  /v1/agents/sessions/{id}          updated_at = ${pub.updated_at}  (${unit(pub.updated_at)})`);
console.log(`GET  /v1/agents/sessions/{id}/events   data[0].created_at = ${events.data?.[0]?.created_at}  (${unit(events.data?.[0]?.created_at)})`);
console.log(`POST /api/agent/web-shell/v1/sessions/get  createdAt = ${web.createdAt}  (${unit(web.createdAt)})`);
console.log(`POST /api/agent/web-shell/v1/sessions/get  updatedAt = ${web.updatedAt}  (${unit(web.updatedAt)})`);
console.log(`ratio createdAt / created_at = ${(web.createdAt / pub.created_at).toFixed(3)}`);
