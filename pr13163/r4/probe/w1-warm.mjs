// VERIFICATION RIG ONLY (PR #13163, round 4): where does the WebShell "runtime_warm_failed" come from? A later Turn
// reaches environment.ready; then (mode) can_create is revoked and/or the Workspace set DRAINING; the driver restarts
// Spring (the attachment cache is gone and the Turn is re-claimed); phase observe waits WITHOUT cancelling and reads
// the Turn's environment events and the WebShell environment; phase cancel posts the creator's cancel and reads the
// WebShell environment once the Turn is terminal.
// usage: DB=<db> node w1-warm.mjs <start|observe|cancel> <workspace> <storage> <none|revoke|revoke-drain>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, modelEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST, MODE] = process.argv.slice(2);
const STATE = `${RUN}/w1-${WS}.json`;
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
const env = (S, T) => sql(`SELECT sequence_id, event_type, data_json FROM managed_agent_event WHERE session_id='${S}' AND turn_id='${T}' AND event_type LIKE 'environment.%' ORDER BY sequence_id`).map((x) => `${x[0]}:${x[1].replace('environment.', '')}${x[2] !== '{}' ? x[2] : ''}`);
const webEnv = async (S) => { const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'alice' }); return `${j(g.json.environment)} turn=${g.json.latestTurn?.status ?? g.json.turn?.status ?? '-'} workspaceTurns=${g.json.capabilities?.workspaceTurns}`; };
if (PHASE === 'start') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE ${W}`) === '0') register(WS, `st-${ST}`);
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE ${W}`);
  sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=w.txt tag=w0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
  const S = c.json.id;
  await waitTurn(S, { timeoutMs: 90_000 });
  const tag = `warm-${MODE}-${Date.now() % 100000}`;
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_SLOW name=late-${tag}.txt hold=240000 tag=${tag}` }] }, { actor: 'alice', key: k('slow') });
  const T = sub.json.turn_id;
  for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
  for (let i = 0; i < 100 && !env(S, T).some((e) => e.includes(':ready')); i++) await sleep(100);
  const before = env(S, T);
  if (MODE.startsWith('revoke')) sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
  if (MODE === 'revoke-drain') sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE ${W}`);
  fs.writeFileSync(STATE, JSON.stringify({ S, T, tag, before, web0: await webEnv(S) }));
  console.log(`started ${S} turn=${T} env=${j(before)} mode=${MODE}`);
  process.exit(0);
}
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const r = new Report(`w1-${PHASE}-${MODE}-${WS}`);
if (PHASE === 'observe') {
  const OBS = Number(process.env.OBSERVE_MS ?? 25_000);
  await sleep(OBS);
  r.note('environment events before the restart', j(st.before));
  r.note('WebShell environment before the restart', st.web0);
  r.note(`environment events ${OBS / 1000} s after the restart (no cancel)`, j(env(st.S, st.T)));
  r.note(`WebShell environment ${OBS / 1000} s after the restart`, await webEnv(st.S));
  r.note('Turn', j(turnRow(st.S).at(-1)));
  r.done({ ...st, after: env(st.S, st.T) });
  process.exit(0);
}
const t0 = Date.now();
const c = await api('POST', '/api/agent/web-shell/v1/turns/cancel', { sessionId: st.S, turnId: st.T, idempotencyKey: k('cancel') }, { actor: 'alice' });
const end = await waitTurn(st.S, { timeoutMs: 90_000 });
await sleep(2000);
r.note('WebShell turns/cancel by the creator', `${c.status} ${c.json.error?.code ?? c.json.status ?? ''}`);
r.note('Turn end', `${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : `at +${Date.now() - t0 - 2000} ms`}`);
r.note('environment events after the cancel', j(env(st.S, st.T)));
r.note('WebShell environment after the cancel', await webEnv(st.S));
sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE ${W}`);
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
const fin = await waitTurn(st.S, { timeoutMs: 60_000 });
r.note('Turn after restore', `${fin.status} ${fin.timeout ? '(not terminal)' : ''}`);
const nx = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=w.txt tag=w9' }] }, { actor: 'alice', key: k('next') });
const nw = nx.status === 202 ? await waitTurn(st.S, { timeoutMs: 90_000 }) : null;
r.note('next Turn after restore', `${nx.status} ${nw?.status ?? nx.json.error?.code}; WebShell ${await webEnv(st.S)}`);
r.note('Turn history', j(turnRow(st.S)));
r.done({ ...st, cancel: [c.status, c.json.error?.code], end, envAfter: env(st.S, st.T) });
process.exit(0);
