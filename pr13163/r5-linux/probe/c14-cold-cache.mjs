// VERIFICATION RIG ONLY (PR #13163): R3-3 / #13269 cold-cache cancel. Phase "start" begins a long later Turn and
// optionally revokes can_create; the caller restarts Spring (the owner's attachment cache is gone); phase "cancel"
// posts the creator's cancel and watches the Turn, the tap's POST /cancel calls and the model request.
// usage: DB=<db> node c14-cold-cache.mjs start <workspace> <storage> <revoke|none>
//        DB=<db> node c14-cold-cache.mjs cancel <workspace> <storage> <revoke|none>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, readWs, modelEntries, tapEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST, MODE] = process.argv.slice(2);
const STATE = `${RUN}/c14-${WS}.json`;
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
if (PHASE === 'start') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE ${W}`) === '0') register(WS, `st-${ST}`);
  sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=c.txt tag=c0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
  const S = c.json.id;
  const w = await waitTurn(S, { timeoutMs: 90_000 });
  const tag = `cold-${MODE}-${Date.now() % 100000}`;
  const file = `late-${tag}.txt`;
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_SLOW name=${file} hold=${process.env.HOLD ?? 240000} tag=${tag}` }] }, { actor: 'alice', key: k('slow') });
  for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
  if (MODE === 'revoke') sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
  fs.writeFileSync(STATE, JSON.stringify({ S, turn: sub.json.turn_id, tag, file, initial: w.status }));
  console.log(`started ${S} turn=${sub.json.turn_id} initial=${w.status} mode=${MODE}`);
  process.exit(0);
}
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
if (PHASE === 'wait') {
  const rw = new Report(`c14-restart-nocancel-${WS}`);
  const ex0 = Number(one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${st.S}'`));
  rw.note('Turn after the Spring restart (no cancel)', j(turnRow(st.S).at(-1)));
  const end = await waitTurn(st.S, { timeoutMs: 150_000 });
  await sleep(2000);
  const calls = tapEntries().filter((e) => e.path?.startsWith(`/session/${st.S}`) && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat')).map((e) => `${e.method} ${e.path.replace(st.S, ':id')} ${e.status ?? '-'}`);
  const model = modelEntries().filter((e) => e.tag === st.tag).map((e) => e.kind);
  rw.note('Turn end', `${end.status} ${end.error} ${end.timeout ? '(not terminal)' : 'at +' + end.ms + ' ms'}`);
  rw.note('model requests for the Turn', j(model));
  rw.note('Harness calls for the Session', j(calls));
  rw.note('Workspace file / tool executions (whole Session)', `${readWs(ST, `child/${st.file}`)} / ${one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${st.S}'`)}`);
  rw.done({ ...st, end, model, calls, file: readWs(ST, `child/${st.file}`) });
  process.exit(0);
}
const r = new Report(`c14-cold-cache-${MODE}-${WS}`);
r.note('Turn before the cancel (after the Spring restart)', j(turnRow(st.S).at(-1)));
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.turn }, { actor: 'alice', key: k('cancel') });
r.note('creator cancel after the restart', `${c.status} ${c.json.status ?? c.json.error?.code}`);
const end = await waitTurn(st.S, { timeoutMs: 90_000 });
const cancels = tapEntries().filter((e) => e.path === `/session/${st.S}/cancel`).map((e) => ({ at: Date.parse(e.t) - t0, status: e.status ?? null }));
const loads = tapEntries().filter((e) => e.path?.startsWith(`/session/${st.S}`) && Date.parse(e.t) >= t0 - 120_000 && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat')).map((e) => `${e.method} ${e.path.replace(st.S, ':id')} ${e.status ?? '-'}`);
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === st.tag);
r.note('Turn 90 s after the cancel', `${end.status} ${end.error} ${end.timeout ? '(not terminal)' : `at +${end.ms} ms`}`);
r.note('POST /cancel calls reaching the Harness', j(cancels));
r.note('other Harness calls for the Session since the restart', j([...new Set(loads)]));
r.note('model request', aborted ? `aborted after ${aborted.heldMs} ms` : 'still held / answered');
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
const after = await waitTurn(st.S, { timeoutMs: 60_000 });
r.note('Turn 60 s after can_create was restored', `${after.status} ${after.error} ${after.timeout ? '(not terminal)' : ''}`);
r.note('Workspace file', `${readWs(ST, `child/${st.file}`)}`);
r.note('Turn history', j(turnRow(st.S)));
r.done({ ...st, mode: MODE, cancel: c.status, end, cancels, aborted: aborted?.heldMs ?? null, afterRestore: after.status, file: readWs(ST, `child/${st.file}`) });
process.exit(0);
