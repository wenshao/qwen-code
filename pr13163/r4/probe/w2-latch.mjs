// VERIFICATION RIG ONLY (PR #13163, round 4): a Spring outage while the Harness is writing a running Turn's session
// log. Phase start: bound Session, then a later Turn whose model streams a text delta every 200 ms for 40 s. The
// driver restarts Spring mid-stream (no grant change). Phase observe: wait past the stream's end and read the Turn.
// Phase cancel: the creator cancels; read the Turn 60 s later.
// usage: DB=<db> node w2-latch.mjs <start|observe|cancel> <workspace> <storage>
import fs from 'node:fs';
import { api, one, register, waitTurn, turnRow, modelEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST] = process.argv.slice(2);
const STATE = `${RUN}/w2-${WS}.json`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
if (PHASE === 'start') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=l.txt tag=l0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
  const w0 = await waitTurn(c.json.id, { timeoutMs: 90_000 });
  const tag = `trickle-${Date.now() % 100000}`;
  const sub = await api('POST', `/v1/agents/sessions/${c.json.id}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_TRICKLE secs=40 every=200 tag=${tag}` }] }, { actor: 'alice', key: k('t') });
  for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'TRICKLE' && e.tag === tag); i++) await sleep(100);
  await sleep(2000);
  fs.writeFileSync(STATE, JSON.stringify({ S: c.json.id, T: sub.json.turn_id, tag, t0: Date.now(), first: w0.status }));
  console.log(`started ${c.json.id} turn=${sub.json.turn_id} first=${w0.status}`);
  process.exit(0);
}
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const r = new Report(`w2-${PHASE}-${WS}`);
if (PHASE === 'observe') {
  while (Date.now() - st.t0 < 75_000) await sleep(1000);
  const deltas = Number(one(`SELECT COUNT(*) FROM managed_agent_event WHERE session_id='${st.S}' AND turn_id='${st.T}' AND event_type='item.output_text.delta'`));
  r.note('model stream', j(modelEntries().filter((e) => e.tag === st.tag).map((e) => e.kind)));
  r.note('Turn ~35 s after the stream ended (no cancel)', `${j(turnRow(st.S).at(-1))}; public deltas recorded=${deltas}`);
  r.done({ ...st, turn: turnRow(st.S).at(-1) });
  process.exit(0);
}
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.T }, { actor: 'alice', key: k('cancel') });
const end = await waitTurn(st.S, { timeoutMs: 60_000 });
r.note('creator cancel', `${c.status} ${c.json.error?.code ?? c.json.status ?? ''} -> ${end.status} ${end.timeout ? '(not terminal after 60 s)' : `at +${Date.now() - t0} ms`}`);
const nx = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN next' }] }, { actor: 'alice', key: k('next') });
r.note('next submit', `${nx.status} ${nx.json.error?.code ?? nx.json.turn_id}`);
r.note('Turn history', j(turnRow(st.S)));
r.done({ ...st, cancel: [c.status, c.json.error?.code], end: end.status });
process.exit(0);
