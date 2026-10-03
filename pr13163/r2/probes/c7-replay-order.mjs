// VERIFICATION RIG ONLY (PR #13163): submit and rename now answer a same-key replay before the admission gate.
// Who can replay alice's recorded submit / rename, and what do they get back?
// usage: DB=<db> node c7-replay-order.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, Report, TENANT, j } from './lib.mjs';
const [WS, ST] = [process.argv[2], process.argv[3]];
const r = new Report(`c7-replay-order-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const restore = () => { sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`); sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`); };
restore();
const stamp = Date.now();
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=r.txt tag=r0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const turnBody = { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN later' }] };
const K1 = `turn-${stamp}`;
const first = await api('POST', `/v1/agents/sessions/${S}/events`, turnBody, { actor: 'alice', key: K1 });
await waitTurn(S, { timeoutMs: 60_000 });
const R1 = `rename-${stamp}`;
const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'private title' }, { actor: 'alice', key: R1 });
r.note('alice: submit K1 / rename R1', `${first.status} ${first.json.turn_id}; ${rn.status} ${rn.json.metadata?.title}`);
const rows = [];
for (const actor of ['mallory', 'bob', 'carol']) {
  const read = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor });
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, turnBody, { actor, key: K1 });
  const ren = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'private title' }, { actor, key: R1 });
  const row = { actor, read: read.status, submitReplay: `${sub.status} ${sub.json.turn_id ?? sub.json.error?.code} replay=${sub.headers['x-qwen-idempotent-replay'] ?? '-'}`, renameReplay: `${ren.status} ${ren.json.metadata?.title ?? ren.json.error?.code}` };
  rows.push(row);
  r.note(`${actor}: GET session / replay alice's submit key / replay alice's rename key`, j(row));
}
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
const subA = await api('POST', `/v1/agents/sessions/${S}/events`, turnBody, { actor: 'alice', key: K1 });
const renA = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'private title' }, { actor: 'alice', key: R1 });
r.note('alice after can_create revoked: replay K1 / R1', `${subA.status} ${subA.json.turn_id ?? subA.json.error?.code}; ${renA.status} ${renA.json.metadata?.title ?? renA.json.error?.code}`);
restore();
r.note('Turn history (no new Turn from replays)', j(turnRow(S)));
r.done({ session: S, rows, aliceRevoked: { submit: subA.status, rename: renA.status } });
process.exit(0);
