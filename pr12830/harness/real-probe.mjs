// Drive a real Managed Agent server (Tomcat + MySQL) and record every exchange.
// usage: node real-probe.mjs <baseUrl> <out.json>
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const [base, out] = process.argv.slice(2);
const tenant = 'tenant-pr12830-' + randomUUID().slice(0, 8);
const WS = '/api/agent/web-shell/v1';
const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(label, operationId, method, path, { body, key, accept } = {}) {
  const headers = { 'X-Qwen-Tenant-Id': tenant, Accept: accept ?? 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  const rec = { label, operationId, method, path, request: body, status: res.status, contentType: res.headers.get('content-type'), json, text: json === undefined ? text.slice(0, 300) : undefined };
  log.push(rec);
  return rec;
}
// Existing, shipped routes.
const s1 = (await call('create public session', 'createSession', 'POST', '/v1/agents/sessions', { key: 'k-create', body: { agent_id: 'qwen-code', metadata: { title: 'pr12830' }, input: [] } })).json.id;
await call('get session', 'getSession', 'GET', `/v1/agents/sessions/${s1}`);
await call('list sessions', 'listSessions', 'GET', '/v1/agents/sessions?limit=100');
// The 14 routes this PR adds as planned.
const T = 'task-probe-1';
const planned = [
  ['listSessionTasks', 'GET', `/v1/agents/sessions/${s1}/tasks`],
  ['getSessionTask', 'GET', `/v1/agents/sessions/${s1}/tasks/${T}`],
  ['listSessionTaskEvents', 'GET', `/v1/agents/sessions/${s1}/tasks/${T}/events?after=c1`],
  ['cancelSessionTask', 'POST', `/v1/agents/sessions/${s1}/tasks/${T}/cancel`, { key: 'k-task-cancel' }],
  ['queryWebShellTasks', 'POST', `${WS}/tasks/query`, { body: { sessionId: s1 } }],
  ['getWebShellTask', 'POST', `${WS}/tasks/get`, { body: { sessionId: s1, taskId: T } }],
  ['queryWebShellTaskEvents', 'POST', `${WS}/tasks/events/query`, { body: { sessionId: s1, taskId: T } }],
  ['cancelWebShellTask', 'POST', `${WS}/tasks/cancel`, { body: { sessionId: s1, taskId: T, idempotencyKey: 'k-ws-task-cancel' } }],
  ['getSessionMcpCatalog', 'GET', `/v1/agents/sessions/${s1}/mcp-catalog`],
  ['getSessionHookCatalog', 'GET', `/v1/agents/sessions/${s1}/hook-catalog`],
  ['listAgentChannels', 'GET', '/v1/agent-channels'],
  ['listAgentChannelDeliveries', 'GET', '/v1/agent-channels/ch-1/deliveries'],
  ['listAgentAutomations', 'GET', '/v1/agent-automations'],
  ['listAgentAutomationRuns', 'GET', '/v1/agent-automations/au-1/runs'],
];
for (const [op, m, p, opt] of planned) await call('planned ' + op, op, m, p, opt ?? {});
// Turn cancel precedent: retry the same cancel key after the turn settled.
const w = (await call('webshell create', 'webShellCreateSession', 'POST', `${WS}/sessions/create`, { body: { requestId: 'r1', idempotencyKey: 'k-ws-create', agentId: 'qwen-code', title: 'pr12830-ws', input: [] } })).json.sessionId;
const turn = (await call('webshell submit', 'webShellSubmitTurn', 'POST', `${WS}/turns/submit`, { body: { requestId: 'r2', idempotencyKey: 'k-ws-submit', sessionId: w, input: [{ type: 'text', text: 'hold' }] } })).json.turnId;
await call('webshell cancel #1', 'webShellCancelTurn', 'POST', `${WS}/turns/cancel`, { body: { requestId: 'r3', idempotencyKey: 'k-ws-stop', sessionId: w, turnId: turn } });
let settled;
for (let i = 0; i < 40; i++) {
  settled = await call('webshell get (poll)', 'webShellGetSession', 'POST', `${WS}/sessions/get`, { body: { sessionId: w } });
  const st = settled.json?.activeTurn?.status;
  if (!settled.json?.activeTurn || ['cancelled', 'completed', 'failed'].includes(st)) break;
  log.pop(); await sleep(250);
}
await call('webshell cancel #2 same key after settle', 'webShellCancelTurn', 'POST', `${WS}/turns/cancel`, { body: { requestId: 'r4', idempotencyKey: 'k-ws-stop', sessionId: w, turnId: turn } });
await call('webshell cancel #3 new key after settle', 'webShellCancelTurn', 'POST', `${WS}/turns/cancel`, { body: { requestId: 'r5', idempotencyKey: 'k-ws-stop-2', sessionId: w, turnId: turn } });
await call('webshell transcript', 'webShellTranscript', 'POST', `${WS}/transcript/query`, { body: { sessionId: w } });
await call('webshell list', 'webShellListSessions', 'POST', `${WS}/sessions/query`, { body: { limit: 100 } });
// Lifecycle routes whose 202 schema (PublicCommandOperation) this PR edits.
await call('archive', 'archiveSession', 'POST', `/v1/agents/sessions/${s1}/archive`, { key: 'k-archive' });
await call('unarchive', 'unarchiveSession', 'POST', `/v1/agents/sessions/${s1}/unarchive`, { key: 'k-unarchive' });
await call('delete', 'deleteSession', 'DELETE', `/v1/agents/sessions/${s1}`, { key: 'k-delete' });
await call('delete webshell session', 'deleteSession', 'DELETE', `/v1/agents/sessions/${w}`, { key: 'k-delete-w' });
writeFileSync(out, JSON.stringify({ base, tenant, log }, null, 1));
console.log(log.map((r) => `${String(r.status).padEnd(4)} ${r.label}`).join('\n'));
