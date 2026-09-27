// Bound (W0b/W0d) Sessions on real Spring + MySQL through both surfaces, with a
// trusted actor from the rig adapter (X-Rig-Actor). Records exchanges in the
// validate.mjs format.
//   node drive-bound.mjs <baseUrl> <out.jsonl>
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [base, out] = process.argv.slice(2);
const T = 'rig-bound';
const WS = '/api/agent/web-shell/v1';
const run = randomUUID().slice(0, 8);
const record = (e) => fs.appendFileSync(out, JSON.stringify(e) + '\n');

async function call(op, expected, method, path, { body, query, headers = {}, actor = 'alice', note } = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const h = { 'X-Qwen-Tenant-Id': T, accept: 'application/json', ...headers };
  if (actor) h['X-Rig-Actor'] = actor;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  record({ kind: 'exchange', tenant: T, op, expected, method, path: url.pathname + url.search, note, request: body ?? null, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: json, raw: json ? undefined : text.slice(0, 300) });
  const ws = json?.workspace;
  console.log(`${op.padEnd(24)} ${method.padEnd(5)} ${res.status} (spec ${expected}) ${json?.error?.code ?? ''}${ws ? ' workspace=' + JSON.stringify(ws) : ''} ${note ?? ''}`);
  return json;
}

await call('listWorkspaces', 200, 'GET', '/v1/agents/workspaces');
await call('getWorkspace', 200, 'GET', '/v1/agents/workspaces/ws-default');
await call('getWorkspace', 404, 'GET', '/v1/agents/workspaces/ws-nope', { note: 'unknown workspace' });
await call('webShellQueryWorkspaces', 200, 'POST', `${WS}/workspaces/query`, { body: {} });
await call('webShellGetWorkspace', 200, 'POST', `${WS}/workspaces/get`, { body: { workspaceId: 'ws-default' } });

const createBody = { agent_id: 'qwen-code', input: [], workspace: { workspace_id: 'ws-default', cwd_relative: 'services/./api' } };
const pub = await call('createSession', 202, 'POST', '/v1/agents/sessions', { body: createBody, headers: { 'Idempotency-Key': `kb-${run}` }, note: 'bound' });
await call('createSession', 202, 'POST', '/v1/agents/sessions', { body: createBody, headers: { 'Idempotency-Key': `kb-${run}` }, note: 'bound replay' });
await call('createSession', 409, 'POST', '/v1/agents/sessions', { body: { ...createBody, agent_revision: '1' }, headers: { 'Idempotency-Key': `kb-${run}` }, note: 'bound retry adds agent_revision' });
await call('createSession', 400, 'POST', '/v1/agents/sessions', { body: { ...createBody, agent_revision: '9' }, headers: { 'Idempotency-Key': `kb2-${run}` }, note: 'bound new admission, foreign revision' });
await call('createSession', 401, 'POST', '/v1/agents/sessions', { body: createBody, headers: { 'Idempotency-Key': `kb3-${run}` }, actor: null, note: 'bound without actor' });
await call('getSession', 200, 'GET', `/v1/agents/sessions/${pub.id}`, { note: 'bound' });
await call('listSessions', 200, 'GET', '/v1/agents/sessions', { query: { limit: 100 }, note: 'with bound' });

const wsBody = { requestId: `rq-${run}`, idempotencyKey: `wb-${run}`, agentId: 'qwen-code', title: 'bound web', input: [], workspace: { workspaceId: 'ws-default', cwdRelative: 'web' } };
const web = await call('webShellCreateSession', 202, 'POST', `${WS}/sessions/create`, { body: wsBody, note: 'bound' });
await call('webShellGetSession', 200, 'POST', `${WS}/sessions/get`, { body: { sessionId: web.sessionId }, note: 'bound' });
await call('webShellListSessions', 200, 'POST', `${WS}/sessions/query`, { body: { limit: 100 }, note: 'with bound' });
await call('getSession', 200, 'GET', `/v1/agents/sessions/${web.sessionId}`, { note: 'WebShell-created bound Session via public API' });
await call('webShellGetSession', 200, 'POST', `${WS}/sessions/get`, { body: { sessionId: pub.id }, note: 'public-created bound Session via WebShell' });
console.log(JSON.stringify({ tenant: T, publicBound: pub.id, webBound: web.sessionId }));
