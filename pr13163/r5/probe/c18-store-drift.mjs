// VERIFICATION RIG ONLY (PR #13163, round 5): b8f92ced answers a resident reattach whose Session Store address
// drifted with a retryable 409 hosted_session_store_mismatch (was 404). Phase start: a bound later Turn runs
// (grants intact); the driver restarts Spring with a different session-store base-url (same server, other spelling);
// phase cancel: the creator cancels; watch the Harness calls and whether the Turn ever ends.
// usage: DB=<db> node c18-store-drift.mjs <start|cancel> <workspace> <storage>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, modelEntries, tapEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST] = process.argv.slice(2);
const STATE = `${RUN}/c18-${WS}.json`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
if (PHASE === 'start') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=d.txt tag=d0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
  await waitTurn(c.json.id, { timeoutMs: 90_000 });
  const tag = `drift-${Date.now() % 100000}`;
  const sub = await api('POST', `/v1/agents/sessions/${c.json.id}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_SLOW name=late-${tag}.txt hold=240000 tag=${tag}` }] }, { actor: 'alice', key: k('slow') });
  for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
  await sleep(3000);
  fs.writeFileSync(STATE, JSON.stringify({ S: c.json.id, T: sub.json.turn_id, tag }));
  console.log(`started ${c.json.id} turn=${sub.json.turn_id}`);
  process.exit(0);
}
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const r = new Report(`c18-store-drift-${WS}`);
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.T }, { actor: 'alice', key: k('cancel') });
const end = await waitTurn(st.S, { timeoutMs: 120_000 });
const calls = tapEntries().filter((e) => e.path?.startsWith(`/session/${st.S}`) && Date.parse(e.t) >= t0 - 90_000 && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat'));
const summary = {};
for (const e of calls) { const key = `${e.method} ${e.path.replace(st.S, ':id')} ${e.status ?? '-'}`; summary[key] = (summary[key] ?? 0) + 1; }
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === st.tag);
r.note('store base-url seen by the Harness on the last load', j(calls.filter((e) => e.path.endsWith('/load')).at(-1)?.body?.managedSessionStore?.baseUrl ?? null));
r.note('creator cancel after the restart', `${c.status} ${c.json.status ?? c.json.error?.code}`);
r.note('Turn 120 s after the cancel', `${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : `at +${Date.now() - t0} ms`}`);
r.note('Harness calls for the Session since the restart (count)', j(summary));
r.note('model request', aborted ? `aborted after ${aborted.heldMs} ms` : 'still held / answered');
r.note('Turn history', j(turnRow(st.S)));
r.done({ ...st, cancel: [c.status, c.json.error?.code], end, summary });
process.exit(0);
