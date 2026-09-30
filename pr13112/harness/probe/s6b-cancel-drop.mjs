// VERIFICATION RIG ONLY (PR #13112): one lost POST /session/:id/cancel (tap drop-before). Is a cancel ever re-sent?
// usage: DB=<db> node s6b-cancel-drop.mjs <bound|unbound> <workspace> <storage>
import { api, one, register, waitTurn, turnRow, executions, readWs, modelEntries, tapEntries, setTapRules, Report, sleep, TENANT, j } from './lib.mjs';

const [KIND, WS, ST] = [process.argv[2] ?? 'unbound', process.argv[3] ?? 'ws-f', process.argv[4] ?? 'f'];
const r = new Report(`s6b-cancel-drop-${KIND}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${KIND}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=base.txt tag=b0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const created = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', '');
const tag = `drop-${KIND}-${Date.now() % 100000}`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=late-${KIND}.txt hold=8000 tag=${tag}`), { actor: 'alice', key: k('slow') });
for (let i = 0; i < 200 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
setTapRules([{ match: `POST /session/${S}/cancel`, action: 'drop-before', times: 1 }]);
await sleep(300);
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel') });
const end = await waitTurn(S, { timeoutMs: 60_000 });
setTapRules([]);
await sleep(1500);
const cancels = tapEntries().filter((e) => e.path === `/session/${S}/cancel`);
r.note('cancel admission', `${c.status}`);
r.note('POST /cancel attempts seen by the tap', j(cancels.map((e) => ({ t: e.t, fault: e.fault ?? null, status: e.status ?? null }))));
r.note('Turn end', `${end.status} ${end.error}`);
r.note('model', modelEntries().some((e) => e.kind === 'SLOW-aborted' && e.tag === tag) ? 'aborted' : 'answered after the cancel');
if (KIND === 'bound') r.note('Workspace file written by the "cancelled" Turn', `${readWs(ST, `child/late-${KIND}.txt`)}; executions=${executions(S)}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S });
