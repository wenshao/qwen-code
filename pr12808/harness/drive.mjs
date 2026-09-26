// Drives every non-planned Managed Agent operation over real HTTP against a
// running Spring server (MySQL + packaged hosted harness + scripted model),
// and records each exchange for an independent schema check (validate.mjs).
//   node drive.mjs <baseUrl> <out.jsonl> [tag]
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [base, out, tag = 'run'] = process.argv.slice(2);
const tenant = `rig-${tag}-${randomUUID().slice(0, 8)}`;
const other = `${tenant}-other`;
const WS = '/api/agent/web-shell/v1';
fs.writeFileSync(out, '');
const record = (entry) => fs.appendFileSync(out, JSON.stringify(entry) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(op, expected, method, path, { body, query, headers = {}, t = tenant, note } = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const init = { method, headers: { 'X-Qwen-Tenant-Id': t, accept: 'application/json', ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const h = Object.fromEntries(res.headers.entries());
  record({ kind: 'exchange', tenant: t, op, expected, method, path: url.pathname + url.search, note, request: body ?? null, status: res.status, headers: h, body: json, raw: json ? undefined : text.slice(0, 500) });
  console.log(`${op.padEnd(22)} ${method.padEnd(6)} ${String(res.status)} (spec ${expected}) ${note ?? ''}`);
  return json;
}

function openStream(op, method, path, { body, query } = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const init = { method, headers: { 'X-Qwen-Tenant-Id': tenant, accept: 'text/event-stream' }, signal: controller.signal };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const state = { text: '', status: 0, contentType: '' };
  const done = (async () => {
    try {
      const res = await fetch(url, init);
      state.status = res.status;
      state.contentType = res.headers.get('content-type');
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        state.text += decoder.decode(chunk, { stream: true });
        if (/event: ?session\.deleted\ndata:[^\n]*\n\n/.test(state.text)) break;
      }
    } catch (error) {
      state.error = String(error);
    }
  })();
  return {
    async finish(timeoutMs = 8000) {
      await Promise.race([done, sleep(timeoutMs)]);
      controller.abort();
      record({ kind: 'stream', op, method, path: url.pathname + url.search, request: body ?? null, status: state.status, contentType: state.contentType, text: state.text, error: state.error });
      console.log(`${op.padEnd(22)} STREAM ${state.status} ${state.contentType} ${state.text.length} bytes`);
    },
  };
}

async function session(id, t = tenant) {
  const res = await fetch(`${base}/v1/agents/sessions/${id}`, { headers: { 'X-Qwen-Tenant-Id': t } });
  return res.json();
}
async function until(what, predicate, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(200);
  }
  throw new Error(`timeout: ${what}`);
}
const idle = (id) => until(`idle ${id}`, async () => !(await session(id)).active_turn);
const running = (id) => until(`running ${id}`, async () => (await session(id)).active_turn?.status === 'running');

// ---- Public API -----------------------------------------------------------
const create = { agent_id: 'qwen-code', metadata: { title: 'rig public' }, input: [{ type: 'text', text: 'hello from the public API' }] };
const s1 = (await call('createSession', 202, 'POST', '/v1/agents/sessions', { body: create, headers: { 'Idempotency-Key': 'k-create' } })).id;
const publicStream = openStream('getSessionEvents', 'GET', `/v1/agents/sessions/${s1}/events`, { query: { stream: 'true' } });
await call('createSession', 202, 'POST', '/v1/agents/sessions', { body: create, headers: { 'Idempotency-Key': 'k-create' }, note: 'idempotent replay' });
await call('createSession', 409, 'POST', '/v1/agents/sessions', { body: { agent_id: 'qwen-code' }, headers: { 'Idempotency-Key': 'k-create' }, note: 'key reuse, other body' });
await call('getSession', 404, 'GET', `/v1/agents/sessions/${s1}`, { t: other, note: 'other tenant' });
await idle(s1);
await call('getSession', 200, 'GET', `/v1/agents/sessions/${s1}`);
await call('listSessions', 200, 'GET', '/v1/agents/sessions', { query: { limit: 100 } });
await call('getSessionEvents', 200, 'GET', `/v1/agents/sessions/${s1}/events`);
await call('getSessionEvents', 200, 'GET', `/v1/agents/sessions/${s1}/events`, { query: { limit: 1000 }, note: 'limit=1000 (spec max)' });
const evPage = await call('getSessionEvents', 200, 'GET', `/v1/agents/sessions/${s1}/events`, { query: { limit: 2 }, note: 'page 1' });
if (evPage?.next_cursor) await call('getSessionEvents', 200, 'GET', `/v1/agents/sessions/${s1}/events`, { query: { limit: 2, cursor: evPage.next_cursor }, note: 'page 2 via cursor' });
await call('getSessionEvents', 200, 'GET', `/v1/agents/sessions/${s1}/events`, { query: { after: 2 }, note: 'after=2' });
await call('listItems', 200, 'GET', `/v1/agents/sessions/${s1}/items`, { query: { limit: 100 } });
const itPage = await call('listItems', 200, 'GET', `/v1/agents/sessions/${s1}/items`, { query: { limit: 1 }, note: 'page 1' });
if (itPage?.next_cursor) await call('listItems', 200, 'GET', `/v1/agents/sessions/${s1}/items`, { query: { limit: 1, cursor: itPage.next_cursor }, note: 'page 2 via cursor' });
await call('updateSession', 200, 'PATCH', `/v1/agents/sessions/${s1}`, { body: { title: 'renamed by rig' }, headers: { 'Idempotency-Key': 'k-rename' } });
await call('updateSession', 400, 'PATCH', `/v1/agents/sessions/${s1}`, { body: { title: '' }, headers: { 'Idempotency-Key': 'k-rename-empty' }, note: 'empty title' });
await call('archiveSession', 202, 'POST', `/v1/agents/sessions/${s1}/archive`, { headers: { 'Idempotency-Key': 'k-archive' } });
await call('getSession', 200, 'GET', `/v1/agents/sessions/${s1}`, { note: 'archived session' });
await call('listSessions', 200, 'GET', '/v1/agents/sessions', { query: { limit: 100 }, note: 'after archive' });
await call('unarchiveSession', 200, 'POST', `/v1/agents/sessions/${s1}/unarchive`, { headers: { 'Idempotency-Key': 'k-unarchive' } });

const s2 = (await call('createSession', 202, 'POST', '/v1/agents/sessions', { body: { agent_id: 'qwen-code', input: [] }, headers: { 'Idempotency-Key': 'k-create-idle' }, note: 'no input' })).id;
const held = await call('postSessionEvent', 202, 'POST', `/v1/agents/sessions/${s2}/events`, { body: { type: 'agent.session.input.message', input: [{ type: 'text', text: 'HOLD please' }] }, headers: { 'Idempotency-Key': 'k-input-hold' } });
await running(s2);
await sleep(800);
await call('getSession', 200, 'GET', `/v1/agents/sessions/${s2}`, { note: 'turn running' });
await call('postSessionEvent', 202, 'POST', `/v1/agents/sessions/${s2}/events`, { body: { type: 'agent.session.cancel', turn_id: held.turn_id }, headers: { 'Idempotency-Key': 'k-cancel' } });
await idle(s2);
await call('postSessionEvent', 202, 'POST', `/v1/agents/sessions/${s2}/events`, { body: { type: 'agent.session.input.message', input: [{ type: 'text', text: 'FAIL on purpose' }] }, headers: { 'Idempotency-Key': 'k-input-fail' }, note: 'model answers 400' });
await idle(s2);
await call('getSession', 200, 'GET', `/v1/agents/sessions/${s2}`, { note: 'after failed turn' });
await call('getSessionEvents', 200, 'GET', `/v1/agents/sessions/${s2}/events`, { note: 'cancelled + failed turns' });
await call('listItems', 200, 'GET', `/v1/agents/sessions/${s2}/items`, { note: 'cancelled + failed turns' });
await call('postSessionEvent', 400, 'POST', `/v1/agents/sessions/${s2}/events`, { body: { type: 'agent.session.bogus' }, headers: { 'Idempotency-Key': 'k-bogus' }, note: 'unknown event type' });

// ---- WebShell adapter -----------------------------------------------------
const w1 = (await call('webShellCreateSession', 202, 'POST', `${WS}/sessions/create`, { body: { requestId: 'rig-trace', idempotencyKey: 'w-create', agentId: 'qwen-code', title: 'rig web', metadata: { clientId: 'rig' }, input: [] } })).sessionId;
const webStream = openStream('webShellStreamEvents', 'POST', `${WS}/events/stream`, { body: { sessionId: w1, afterSequence: 0 } });
await call('webShellListSessions', 200, 'POST', `${WS}/sessions/query`, { body: { limit: 100 } });
const wPage = await call('webShellListSessions', 200, 'POST', `${WS}/sessions/query`, { body: { limit: 1 }, note: 'page 1' });
if (wPage?.nextCursor) await call('webShellListSessions', 200, 'POST', `${WS}/sessions/query`, { body: { limit: 1, cursor: wPage.nextCursor }, note: 'page 2 via cursor' });
await call('webShellGetSession', 404, 'POST', `${WS}/sessions/get`, { body: { sessionId: w1 }, t: other, note: 'other tenant' });
await call('webShellSubmitTurn', 202, 'POST', `${WS}/turns/submit`, { body: { requestId: 'rig-trace', idempotencyKey: 'w-submit-1', sessionId: w1, metadata: { clientId: 'rig' }, input: [{ type: 'text', text: 'hello from the WebShell adapter' }] } });
await idle(w1);
const hold = await call('webShellSubmitTurn', 202, 'POST', `${WS}/turns/submit`, { body: { requestId: 'rig-trace', idempotencyKey: 'w-submit-hold', sessionId: w1, input: [{ type: 'text', text: 'HOLD again' }] }, note: 'held' });
await running(w1);
await sleep(800);
await call('webShellGetSession', 200, 'POST', `${WS}/sessions/get`, { body: { sessionId: w1 }, note: 'turn running' });
await call('webShellCancelTurn', 202, 'POST', `${WS}/turns/cancel`, { body: { requestId: 'rig-trace', idempotencyKey: 'w-cancel', sessionId: w1, turnId: hold.turnId } });
await idle(w1);
await call('webShellSubmitTurn', 202, 'POST', `${WS}/turns/submit`, { body: { requestId: 'rig-trace', idempotencyKey: 'w-submit-fail', sessionId: w1, input: [{ type: 'text', text: 'FAIL on purpose' }] }, note: 'model answers 400' });
await idle(w1);
await call('webShellGetSession', 200, 'POST', `${WS}/sessions/get`, { body: { sessionId: w1 } });
await call('webShellTranscript', 200, 'POST', `${WS}/transcript/query`, { body: { sessionId: w1 } });
await call('webShellTranscript', 200, 'POST', `${WS}/transcript/query`, { body: { sessionId: w1, limit: 1000 }, note: 'limit=1000 (spec max)' });
const tPage = await call('webShellTranscript', 200, 'POST', `${WS}/transcript/query`, { body: { sessionId: w1, limit: 2 }, note: 'page 1' });
if (tPage?.olderCursor) await call('webShellTranscript', 200, 'POST', `${WS}/transcript/query`, { body: { sessionId: w1, limit: 2, cursor: tPage.olderCursor }, note: 'older page via cursor' });
const w2 = (await call('webShellCreateSession', 202, 'POST', `${WS}/sessions/create`, { body: { requestId: 'rig-trace', idempotencyKey: 'w-create-2', agentId: 'qwen-code', title: 'rig web 2', input: [{ type: 'text', text: 'first message on create' }] }, note: 'with input' })).sessionId;
await idle(w2);
await call('webShellTranscript', 200, 'POST', `${WS}/transcript/query`, { body: { sessionId: w2 } });

for (const id of [s1, s2, w1, w2]) {
  await call('deleteSession', 202, 'DELETE', `/v1/agents/sessions/${id}`, { headers: { 'Idempotency-Key': `k-delete-${id}` } });
}
await call('getSession', 404, 'GET', `/v1/agents/sessions/${s1}`, { note: 'deleted session' });
await publicStream.finish();
await webStream.finish();
console.log('tenant', tenant, 'sessions', s1, s2, w1, w2);
