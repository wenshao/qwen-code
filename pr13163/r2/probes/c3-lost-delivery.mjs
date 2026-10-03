// VERIFICATION RIG ONLY (PR #13163): the Spring -> Harness POST /session/:id/cancel is lost (tap fault) N times.
// Is the cancel re-sent on lease renewal, and does the Turn stay out of the Workspace?
// usage: DB=<db> node c3-lost-delivery.mjs <bound|unbound> <workspace> <storage> <drop-before|drop-after|respond503> <times>
import { api, one, register, waitTurn, turnRow, executions, readWs, modelEntries, tapEntries, setTapRules, Report, sleep, TENANT, j } from './lib.mjs';

const [KIND, WS, ST, FAULT, TIMES] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] ?? 'drop-before', Number(process.argv[6] ?? 1)];
const HOLD = Number(process.env.HOLD ?? 90000);
const r = new Report(`c3-${KIND}-${FAULT}-x${TIMES}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${KIND}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=base.txt tag=d0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const created = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const ex0 = KIND === 'bound' ? executions(S) : 0;
const tag = `c3-${KIND}-${Date.now() % 100000}`;
const file = `late-${tag}.txt`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=${file} hold=${HOLD} tag=${tag}`), { actor: 'alice', key: k('slow') });
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
const rule = FAULT === 'respond503' ? { match: `POST /session/${S}/cancel`, action: 'respond', status: 503, body: { error: 'rig' }, times: TIMES } : { match: `POST /session/${S}/cancel`, action: FAULT, times: TIMES };
setTapRules([rule]);
await sleep(300);
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel') });
const end = await waitTurn(S, { timeoutMs: HOLD + 60_000 });
const endAt = Date.now() - t0;
setTapRules([]);
await sleep(1500);
const cancels = tapEntries().filter((e) => e.path === `/session/${S}/cancel`).map((e) => ({ at: Date.parse(e.t) - t0, fault: e.fault ?? null, status: e.status ?? null }));
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === tag);
r.note('cancel admission', `${c.status} ${c.json.status ?? c.json.error?.code}`);
r.note('POST /cancel attempts seen by the tap (ms after the cancel)', j(cancels));
r.note('Turn end', `${end.status} ${end.error} at +${endAt} ms`);
r.note('model', aborted ? `aborted after ${aborted.heldMs} ms held` : 'answered after the cancel');
const content = KIND === 'bound' ? readWs(ST, `child/${file}`) : null;
if (KIND === 'bound') r.note('Workspace file written by the cancelled Turn', `${content}; executions added=${executions(S) - ex0}`);
r.check('Turn ended CANCELLED', end.status === 'CANCELLED', end.status);
r.check(`cancel delivered after ${TIMES} lost attempt(s)`, cancels.length > TIMES && cancels.at(-1).fault === null, `${cancels.length} attempts`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, kind: KIND, fault: FAULT, times: TIMES, cancels, end: { ...end, at: endAt }, aborted: aborted?.heldMs ?? null, file: content });
process.exit(0);
