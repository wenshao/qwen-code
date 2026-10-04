// VERIFICATION RIG ONLY (PR #13163, round 4): is "the next bound Turn after a Spring restart fails" a rig artifact?
// Phase start: bound Session, one Turn completes, Session idle. The driver restarts Spring. Phase next: one more Turn.
// usage: DB=<db> node r9-next.mjs <start|next> <workspace> <storage>
import fs from 'node:fs';
import { api, one, register, waitTurn, turnRow, Report, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST] = process.argv.slice(2);
const STATE = `${RUN}/r9-${WS}.json`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
if (PHASE === 'start') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=n.txt tag=n0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
  const w = await waitTurn(c.json.id, { timeoutMs: 90_000 });
  fs.writeFileSync(STATE, JSON.stringify({ S: c.json.id }));
  console.log(`start ${c.json.id} ${w.status}`);
  process.exit(0);
}
const { S } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const r = new Report(`r9-next-${WS}`);
const x = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=n.txt tag=n1' }] }, { actor: 'alice', key: k('n1') });
const w = await waitTurn(S, { timeoutMs: 120_000 });
r.note('first bound Turn after an idle Spring restart', `${x.status} -> ${w.status} ${w.error ?? ''} in ${w.ms} ms`);
const y = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=n.txt tag=n2' }] }, { actor: 'alice', key: k('n2') });
const w2 = await waitTurn(S, { timeoutMs: 120_000 });
r.note('second Turn', `${y.status} -> ${w2.status} ${w2.error ?? ''} in ${w2.ms} ms`);
const c2 = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=n.txt tag=n3' }], workspace: { workspace_id: WS, cwd_relative: 'child2' } }, { actor: 'alice', key: k('c2') });
const w3 = await waitTurn(c2.json.id, { timeoutMs: 120_000 });
r.note('a new bound Session after the restart', `${c2.status} -> ${w3.status} ${w3.error ?? ''}`);
r.note('Turn history', j(turnRow(S)));
r.done({ S, first: w.status, second: w2.status, fresh: w3.status });
process.exit(0);
