// VERIFICATION RIG ONLY (PR #13163): the author's P2 late-rename sequence on the real stack.
// R1 renames to A with key K1 and its Harness title call is held (tap delay); R2 repeats K1 and the Harness refuses it
// once (tap 400), so K1's row is retired (FAILED); R3 renames to B with K2 and completes; then R1's held call reaches
// the Harness. Which title does the database keep, and which title did the Harness receive last?
// usage: DB=<db> node c12-late-rename.mjs <bound|unbound> <workspace> <storage>
import { api, one, register, waitTurn, setTapRules, tapEntries, sql, Report, sleep, TENANT, j } from './lib.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const r = new Report(`c12-late-rename-${KIND}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=t.txt tag=t0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const path = `/session/${S}/title`;
setTapRules([{ match: `POST ${path}`, action: 'delay', delayMs: 8000, times: 1 }, { match: `POST ${path}`, action: 'respond', status: 400, body: { error: { code: 'rig_refusal' } }, times: 1 }]);
await sleep(300);
const K1 = `k1-${stamp}`;
const p1 = api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title A' }, { actor: 'alice', key: K1, timeoutMs: 30_000 });
await sleep(800);
const r2 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title A' }, { actor: 'alice', key: K1 });
const rowAfterR2 = sql(`SELECT command_status FROM managed_agent_command WHERE session_id='${S}' AND idempotency_key='${K1}'`)[0]?.[0];
const r3 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title B' }, { actor: 'alice', key: `k2-${stamp}` });
const r1 = await p1;
setTapRules([]);
await sleep(1000);
const pub = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const calls = tapEntries().filter((e) => e.path === path && e.method === 'POST').map((e) => ({ t: e.t, title: e.body?.title, fault: e.fault ?? null, status: e.status ?? null }));
// The tap stamps arrival time; a delayed call is forwarded 8 s later, so order by arrival + delay.
const at = (x) => Date.parse(x.t) + (x.fault === 'delay' ? 8000 : 0);
const applied = calls.filter((x) => x.status === 200).sort((a, b) => at(a) - at(b));
r.note('R1 (K1 → A, Harness call held 8 s)', `${r1.status} ${r1.json.error?.code ?? r1.json.metadata?.title}`);
r.note('R2 (K1 → A again, Harness answers 400)', `${r2.status} ${r2.json.error?.code ?? r2.json.metadata?.title}; K1 row then ${rowAfterR2}`);
r.note('R3 (K2 → B)', `${r3.status} ${r3.json.error?.code ?? r3.json.metadata?.title}`);
r.note('database title afterwards', `${pub.json.metadata?.title}`);
r.note('title calls the Harness applied, in order', j(applied.map((x) => x.title)));
r.note('last title the Harness persisted', `${applied.at(-1)?.title}`);
const ev = sql(`SELECT event_type, COALESCE(source_key,'') FROM managed_agent_event WHERE session_id='${S}' AND event_type LIKE 'session.%' ORDER BY sequence_id`).map((x) => x.join(' '));
r.note('session.* events', j(ev));
r.done({ session: S, kind: KIND, r1: { status: r1.status, code: r1.json.error?.code, title: r1.json.metadata?.title }, r2: { status: r2.status, code: r2.json.error?.code }, r3: { status: r3.status, title: r3.json.metadata?.title }, dbTitle: pub.json.metadata?.title, harnessLast: applied.at(-1)?.title, applied: applied.map((x) => x.title) });
process.exit(0);
