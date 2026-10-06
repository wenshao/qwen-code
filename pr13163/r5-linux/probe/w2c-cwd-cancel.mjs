// VERIFICATION RIG ONLY (PR #13163 R5): the merge with #13247 (W2). The creator changes a bound Session's directory
// (context revision 1 -> 2), starts a later Turn in the new directory, then can_create is revoked and the Workspace set
// DRAINING. Phase "live" cancels at once; phases "start"/"cancel" leave a Spring restart (cold attachment cache)
// between them, so the cancel passively re-attaches against the changed binding.
// usage: DB=<db> node w2c-cwd-cancel.mjs live|start|cancel <workspace> <storage>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, readWs, wsFile, modelEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST] = process.argv.slice(2);
const STATE = `${RUN}/w2c-${WS}.json`;
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const unblock = () => { sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`); sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE ${W}`); };
const binding = (S) => sql(`SELECT cwd_relative, context_revision FROM managed_agent_session WHERE session_id='${S}'`)[0];
let st;
const r = new Report(`w2c-${PHASE}-${WS}`);
if (PHASE !== 'cancel') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE ${W}`) === '0') register(WS, `st-${ST}`);
  unblock();
  fs.mkdirSync(wsFile(ST, 'child2'), { recursive: true });
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=w2.txt tag=w0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
  const S = c.json.id;
  r.check('initial Turn COMPLETED in child/', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', `${S} file=${readWs(ST, 'child/w2.txt')}`);
  const b0 = binding(S);
  const ch = await api('POST', `/v1/agents/sessions/${S}/cwd`, { cwd_relative: 'child2', expected_context_revision: Number(b0[1]) }, { actor: 'alice', key: k('cwd') });
  const opId = ch.json.operation_id ?? ch.json.id;
  let op = null;
  for (let i = 0; i < 200 && opId; i++) { op = await api('GET', `/v1/agents/sessions/${S}/operations/${opId}`, undefined, { actor: 'alice' }); if (['completed', 'failed'].includes(op.json.status)) break; await sleep(300); }
  const b1 = binding(S);
  r.check('W2 cwd change completed (child -> child2, revision +1)', op?.json.status === 'completed' && b1[0] === 'child2' && Number(b1[1]) === Number(b0[1]) + 1, `${ch.status} -> ${op?.json.status} ${op?.json.failure_code ?? ''}; binding ${j(b0)} -> ${j(b1)}`);
  const tag = `w2c-${PHASE}-${Date.now() % 100000}`;
  const file = `late-${tag}.txt`;
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=${file} hold=${process.env.HOLD ?? 240000} tag=${tag}`), { actor: 'alice', key: k('slow') });
  for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
  sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
  sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE ${W}`);
  st = { S, turn: sub.json.turn_id, tag, file, admitted: sub.status };
  r.note('later Turn admitted in child2, then create revoked + DRAINING', `${sub.status} ${st.turn}`);
  if (PHASE === 'start') { fs.writeFileSync(STATE, JSON.stringify(st)); r.done(st); process.exit(0); }
} else st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const t0 = Date.now();
const caps = (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: st.S }, { actor: 'alice' })).json.capabilities;
const cancel = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.turn }, { actor: 'alice', key: k('cancel') });
r.note(`creator cancel (${PHASE === 'cancel' ? 'after Spring restart' : 'live'})`, `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code} in ${cancel.ms} ms; workspaceTurns=${caps?.workspaceTurns}`);
const end = await waitTurn(st.S, { timeoutMs: 90_000 });
await sleep(1500);
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === st.tag);
r.note('Turn end', `${end.status} ${end.error} ${end.timeout ? '(not terminal)' : `at +${Date.now() - t0 - 1500} ms`}`);
r.note('model request', aborted ? `aborted after ${aborted.heldMs} ms` : 'not aborted');
r.note('late file in child2 / child', `${readWs(ST, `child2/${st.file}`)} / ${readWs(ST, `child/${st.file}`)}`);
unblock();
const next = await api('POST', `/v1/agents/sessions/${st.S}/events`, msg(`G_WRITE name=after-${st.tag}.txt content=after`), { actor: 'alice', key: k('next') });
const nextEnd = next.status === 202 ? await waitTurn(st.S, { timeoutMs: 90_000 }) : null;
r.note('next Turn after restore writes into child2', `${next.status} -> ${nextEnd?.status}; child2=${readWs(ST, `child2/after-${st.tag}.txt`)} child=${readWs(ST, `child/after-${st.tag}.txt`)}`);
r.note('command rows', j(sql(`SELECT operation, command_status FROM managed_agent_command WHERE session_id='${st.S}' ORDER BY created_at`)));
r.note('Turn history', j(turnRow(st.S)));
r.done({ ...st, phase: PHASE, cancel: [cancel.status, cancel.json.status ?? cancel.json.error?.code], workspaceTurns: caps?.workspaceTurns, end, aborted: aborted?.heldMs ?? null, file2: readWs(ST, `child2/${st.file}`), next: nextEnd?.status ?? next.status, nextFile: readWs(ST, `child2/after-${st.tag}.txt`) });
process.exit(0);
