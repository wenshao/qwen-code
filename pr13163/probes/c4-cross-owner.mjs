// VERIFICATION RIG ONLY (PR #13163): two Spring JVMs on one database. Spring A owns the running Turn; the cancel is
// admitted by Spring B, which cannot bind the Turn. Does A's lease renewal deliver it? Optionally the first N
// deliveries are lost and/or alice's can_create is revoked before the cancel.
// usage: DB=<db> node c4-cross-owner.mjs <bound|unbound> <workspace> <storage> <lost N> <revoke|none>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, tapEntries, setTapRules, Report, sleep, TENANT, BASE, BASE_B, j } from './lib.mjs';

const [KIND, WS, ST, LOST, AUTH] = [process.argv[2], process.argv[3], process.argv[4], Number(process.argv[5] ?? 0), process.argv[6] ?? 'none'];
const HOLD = Number(process.env.HOLD ?? 90000);
const r = new Report(`c4-${KIND}-lost${LOST}-${AUTH}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
if (KIND === 'bound') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE ${W}`) === '0') register(WS, `st-${ST}`);
  sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
}
const k = (s) => `${s}-${KIND}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=x.txt tag=x0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const created = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: k('create'), base: BASE });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const ex0 = KIND === 'bound' ? executions(S) : 0;
const tag = `c4-${KIND}-${Date.now() % 100000}`;
const file = `late-${tag}.txt`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=${file} hold=${HOLD} tag=${tag}`), { actor: 'alice', key: k('slow'), base: BASE });
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
const owner = sql(`SELECT dispatch_owner, dispatch_lease_until FROM managed_agent_turn WHERE turn_id='${sub.json.turn_id}'`)[0];
r.note('running Turn owner (submitted through Spring A)', j(owner));
if (LOST) setTapRules([{ match: `POST /session/${S}/cancel`, action: 'drop-before', times: LOST }]);
if (AUTH === 'revoke') sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
await sleep(300);
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel'), base: BASE_B });
r.note('cancel admitted by Spring B', `${c.status} ${c.json.status ?? c.json.error?.code} in ${c.ms} ms`);
const end = await waitTurn(S, { timeoutMs: HOLD + 60_000 });
const endAt = Date.now() - t0;
setTapRules([]);
if (KIND === 'bound') sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
await sleep(1500);
const cancels = tapEntries().filter((e) => e.path === `/session/${S}/cancel`).map((e) => ({ at: Date.parse(e.t) - t0, fault: e.fault ?? null, status: e.status ?? null }));
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === tag);
r.note('POST /cancel attempts seen by the tap (ms after the cancel)', j(cancels));
r.note('Turn end', `${end.status} ${end.error} at +${endAt} ms`);
r.note('model', aborted ? `aborted after ${aborted.heldMs} ms held` : 'answered after the cancel');
const content = KIND === 'bound' ? readWs(ST, `child/${file}`) : null;
if (KIND === 'bound') r.note('Workspace file', `${content}; executions added=${executions(S) - ex0}`);
r.check('Turn ended CANCELLED', end.status === 'CANCELLED', end.status);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, kind: KIND, lost: LOST, auth: AUTH, owner, cancel: { status: c.status, ms: c.ms }, cancels, end: { ...end, at: endAt }, aborted: aborted?.heldMs ?? null, file: content });
process.exit(0);
