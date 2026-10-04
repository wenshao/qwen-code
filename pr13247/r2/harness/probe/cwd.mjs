// VERIFICATION RIG ONLY: cwd-change helpers for the PR #13247 rig.
import fs from 'node:fs';
import { api, BASE, TENANT, sql, one, sleep, RUN } from './lib.mjs';

export const pubChange = (session, cwd, rev, { key, actor = 'alice', tenant = TENANT, raw } = {}) =>
  api('POST', `/v1/agents/sessions/${session}/cwd`, raw ?? { cwd_relative: cwd, expected_context_revision: rev }, { key, actor, tenant });

export const webChange = (session, cwd, rev, { key, actor = 'alice', tenant = TENANT, raw, requestId } = {}) =>
  api(
    'POST',
    '/api/agent/web-shell/v1/sessions/cwd/change',
    raw ?? { sessionId: session, idempotencyKey: key, cwdRelative: cwd, expectedContextRevision: rev, ...(requestId ? { requestId } : {}) },
    { actor, tenant },
  );

export const change = (surface, ...a) => (surface === 'web' ? webChange(...a) : pubChange(...a));

export const opId = (r) => r.json.id ?? r.json.operationId;

export const pubOp = (session, op, opts = {}) => api('GET', `/v1/agents/sessions/${session}/operations/${op}`, undefined, opts);
export const webOp = (session, op, opts = {}) => api('POST', '/api/agent/web-shell/v1/operations/query', { sessionId: session, operationId: op }, opts);

export async function waitCwdOp(session, op, { timeoutMs = 30_000, surface = 'public', actor = 'alice' } = {}) {
  const start = Date.now();
  for (;;) {
    const r = surface === 'web' ? await webOp(session, op, { actor }) : await pubOp(session, op, { actor });
    if (['completed', 'failed'].includes(r.json.status)) return { ...r, ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { ...r, ms: Date.now() - start, timeout: true };
    await sleep(100);
  }
}

export const binding = (session) => {
  const r = sql(`SELECT cwd_relative, context_revision, version, status FROM managed_agent_session WHERE session_id='${session}'`)[0];
  return r ? { cwd: r[0], rev: Number(r[1]), version: Number(r[2]), status: r[3] } : null;
};
export const cwdOpRow = (op) => {
  const r = sql(
    `SELECT state, delivery_state, COALESCE(error_code,''), COALESCE(target_cwd_relative,''), COALESCE(expected_context_revision,''), COALESCE(result_context_revision,''), attempt_count, claim_generation, COALESCE(receipt_id,'') FROM managed_agent_operation WHERE operation_id='${op}'`,
  )[0];
  return r ? { state: r[0], delivery: r[1], error: r[2], target: r[3], expected: r[4], result: r[5], attempts: Number(r[6]), gen: Number(r[7]), receipt: r[8] } : null;
};
export const ctxEvents = (session) =>
  sql(`SELECT sequence_id, data_json, source_key FROM managed_agent_event WHERE session_id='${session}' AND event_type='session.context.changed' ORDER BY sequence_id`).map((r) => ({ seq: Number(r[0]), data: JSON.parse(r[1]), source: r[2] }));
export const openOps = (session) => Number(one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${session}' AND state IN ('PENDING','RUNNING','RECOVERY_BLOCKED')`));

export function mkdirWs(storage, rel) {
  fs.mkdirSync(`${RUN}/ws/${storage}/${rel}`, { recursive: true });
}

// Live SSE subscription; returns { events, stop() }.
export function subscribe(kind, session, { actor = 'alice', after = 0 } = {}) {
  const events = [];
  const ac = new AbortController();
  const headers = { Accept: 'text/event-stream', 'X-Qwen-Tenant-Id': TENANT, 'X-Rig-Actor': actor };
  const req =
    kind === 'web'
      ? fetch(`${BASE}/api/agent/web-shell/v1/events/stream`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session, afterSequence: after }), signal: ac.signal })
      : fetch(`${BASE}/v1/agents/sessions/${session}/events?stream=true&after=${after}`, { headers, signal: ac.signal });
  const done = req
    .then(async (res) => {
      events.status = res.status;
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          const ev = block.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim();
          if (data) {
            try {
              events.push({ ev, data: JSON.parse(data), at: Date.now() });
            } catch {
              events.push({ ev, raw: data, at: Date.now() });
            }
          }
        }
      }
    })
    .catch(() => {});
  return { events, stop: () => (ac.abort(), done) };
}
export const typeOf = (e) => e.data?.type ?? e.data?.eventType ?? e.data?.event_type ?? e.ev;
