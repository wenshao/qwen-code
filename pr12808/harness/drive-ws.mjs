// Workspace-bound Session (shipped W0b feature) read back on both surfaces.
import fs from 'node:fs';
const [base, out] = process.argv.slice(2);
fs.writeFileSync(out, '');
const H = { 'X-Qwen-Tenant-Id': 't-ws', 'X-Rig-Actor': 'alice', accept: 'application/json' };
async function call(op, expected, method, path, body, extra = {}, note) {
  const init = { method, headers: { ...H, ...extra } };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(base + path, init);
  const json = await res.json().catch(() => null);
  fs.appendFileSync(out, JSON.stringify({ kind: 'exchange', op, expected, method, path, note, request: body ?? null, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: json }) + '\n');
  console.log(op, res.status, JSON.stringify(json).slice(0, 200));
  return json;
}
const WS = '/api/agent/web-shell/v1';
const s = await call('createSession', 202, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-a', cwd_relative: 'child' } }, { 'Idempotency-Key': 'ws-2' }, 'workspace-bound');
await call('getSession', 200, 'GET', `/v1/agents/sessions/${s.id}`, undefined, {}, 'workspace-bound');
await call('listSessions', 200, 'GET', '/v1/agents/sessions?limit=100', undefined, {}, 'workspace-bound');
await call('webShellGetSession', 200, 'POST', `${WS}/sessions/get`, { sessionId: s.id }, {}, 'workspace-bound');
await call('webShellListSessions', 200, 'POST', `${WS}/sessions/query`, { limit: 100 }, {}, 'workspace-bound');
