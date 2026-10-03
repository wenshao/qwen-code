// VERIFICATION RIG ONLY (PR #13163): the Harness answers the rename (POST /session/:id/title) with a fault once.
// What does the caller get, what is left in managed_agent_command, and can the same key / a fresh key rename afterwards?
// usage: DB=<db> node c8-rename-refused.mjs <bound|unbound> <workspace> <storage> <respond400|respond404|respond500|drop-before>
import { api, sql, one, register, waitTurn, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [KIND, WS, ST, FAULT] = process.argv.slice(2);
const r = new Report(`c8-${KIND}-${FAULT}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=n.txt tag=n0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const cmds = () => sql(`SELECT idempotency_key, command_status FROM managed_agent_command WHERE session_id='${S}' AND operation='RENAME_SESSION'`).map((x) => x.join(':'));
const rule = FAULT.startsWith('respond') ? { match: `POST /session/${S}/title`, action: 'respond', status: Number(FAULT.slice(7)), body: { error: { code: 'rig_refusal', message: 'rig' } }, times: 1 } : { match: `POST /session/${S}/title`, action: FAULT, times: 1 };
setTapRules([rule]);
await sleep(300);
const K = `rename-${stamp}`;
const a = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'first title' }, { actor: 'alice', key: K });
setTapRules([]);
const rowsA = cmds();
r.note(`rename under ${FAULT}`, `${a.status} ${a.json.error?.code ?? a.json.metadata?.title}; command rows ${j(rowsA)}`);
const b = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'first title' }, { actor: 'alice', key: K });
r.note('same key, same title, fault cleared', `${b.status} ${b.json.error?.code ?? b.json.metadata?.title} replay=${b.headers['x-qwen-idempotent-replay'] ?? '-'}; rows ${j(cmds())}`);
const d = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'second title' }, { actor: 'alice', key: `fresh-${stamp}` });
r.note('fresh key', `${d.status} ${d.json.error?.code ?? d.json.metadata?.title}; rows ${j(cmds())}`);
const titleCalls = tapEntries().filter((e) => e.path === `/session/${S}/title`).map((e) => `${e.fault ?? 'pass'}:${e.status ?? '-'}`);
r.note('POST /title calls seen by the tap', j(titleCalls));
const ev = sql(`SELECT event_type, COALESCE(source_key,'') FROM managed_agent_event WHERE session_id='${S}' AND event_type LIKE 'session.%' ORDER BY sequence_id`).map((x) => x.join(' '));
r.note('session.* events', j(ev));
r.done({ session: S, kind: KIND, fault: FAULT, first: { status: a.status, code: a.json.error?.code }, sameKey: { status: b.status, code: b.json.error?.code, title: b.json.metadata?.title, replay: b.headers['x-qwen-idempotent-replay'] ?? null }, fresh: { status: d.status, code: d.json.error?.code }, rowsA, titleCalls, ev });
process.exit(0);
