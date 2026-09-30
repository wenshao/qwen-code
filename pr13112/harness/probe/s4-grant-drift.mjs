// VERIFICATION RIG ONLY (PR #13112): what the creator sees when Workspace grants or state drift after creation.
// The service admits on can_read + creator; execution (WorkspaceExecutionStore.authorize) needs can_read AND can_create
// AND an ACTIVE Workspace.  usage: DB=<db> node s4-grant-drift.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, modelCalls, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST] = [process.argv[2] ?? 'ws-c', process.argv[3] ?? 'c'];
const r = new Report(`s4-grant-drift-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const access = (actor, col, v) => sql(`UPDATE managed_workspace_access SET ${col}=${v} WHERE tenant_id='${TENANT}' AND workspace_id='${WS}' AND actor_id='${actor}'`);
const caps = async (actor = 'alice') => (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor })).json.capabilities?.workspaceTurns;

const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=drift.txt tag=d0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
const t0 = await waitTurn(S, { timeoutMs: 90_000 });
r.check('initial Turn COMPLETED', t0.status === 'COMPLETED', j(t0));

async function laterTurn(label) {
  const models = modelCalls();
  const start = Date.now();
  const x = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_FILES name=drift.txt tag=${label}`), { actor: 'alice', key: k(label) });
  const t = x.status === 202 ? await waitTurn(S, { timeoutMs: 90_000 }) : null;
  return { admit: x.status, code: x.json.error?.code, turn: t?.status, error: t?.error, ms: Date.now() - start, models: modelCalls() - models };
}

// A. can_create revoked, can_read kept
access('alice', 'can_create', 'FALSE');
const capA = await caps();
const a = await laterTurn('revoked-create');
r.note('A. creator lost can_create (still can_read): capability / admission / outcome', `workspaceTurns=${capA} ${j(a)}`);
r.check('A. the refused Turn never reached the model and ran no tool', a.models === 0 && executions(S) === 3, `models=${a.models} exec=${executions(S)}`);
access('alice', 'can_create', 'TRUE');

// B. Workspace no longer ACTIVE
const states = sql(`SELECT DISTINCT state FROM managed_workspace_registry`).flat();
let stateTried = null;
for (const st of ['DRAINING']) {
  try { sql(`UPDATE managed_workspace_registry SET state='${st}' WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`); stateTried = st; break; } catch {}
}
const capB = await caps();
const b = await laterTurn('inactive-ws');
r.note(`B. Workspace state ${stateTried} (states in use: ${states.join(',')}): capability / admission / outcome`, `workspaceTurns=${capB} ${j(b)}`);
sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`);

// C. can_read revoked
access('alice', 'can_read', 'FALSE');
const c = await laterTurn('revoked-read');
const cg = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'alice' });
r.check('C. creator without can_read: submit 404, sessions/get 404', c.admit === 404 && cg.status === 404, `${j(c)} get=${cg.status}`);
access('alice', 'can_read', 'TRUE');

// D. restored grants: the Session works again
const d = await laterTurn('restored');
r.check('D. restored grants: later Turn COMPLETED', d.admit === 202 && d.turn === 'COMPLETED', j(d));

if (process.env.SKIP_E) { r.done({ session: S, a, b, c, d, capA, capB, stateTried }); process.exit(r.fail ? 1 : 0); }
// E. can_create revoked while a later Turn runs, then the creator cancels it
const hold = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_HOLD tag=drift-hold'), { actor: 'alice', key: k('hold') });
for (let i = 0; i < 200 && !modelEntries().some((e) => e.kind === 'HOLD' && e.tag === 'drift-hold'); i++) await sleep(150);
access('alice', 'can_create', 'FALSE');
const cStart = Date.now();
const cancel = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: hold.json.turn_id }, { actor: 'alice', key: k('cancel') });
const e1 = await waitTurn(S, { timeoutMs: 15_000 });
const abortedEarly = modelEntries().some((e) => e.kind === 'HOLD-aborted' && e.tag === 'drift-hold');
r.note('E. cancel admitted while the grant is revoked; state after 15 s', `cancel=${cancel.status} turn=${e1.status} modelAborted=${abortedEarly}`);
access('alice', 'can_create', 'TRUE');
const e2 = await waitTurn(S, { timeoutMs: 150_000 });
const ab = modelEntries().find((e) => e.kind === 'HOLD-aborted' && e.tag === 'drift-hold');
const to = modelEntries().find((e) => e.kind === 'HOLD-timeout' && e.tag === 'drift-hold');
r.note('E. after the grant is restored', `turn=${e2.status} ${e2.error} after ${Date.now() - cStart} ms; modelAborted=${!!ab}${ab ? ` heldMs=${ab.heldMs}` : ''} modelTimedOut=${!!to}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, a, b, c, d, capA, capB, stateTried });
process.exit(r.fail ? 1 : 0);
