// VERIFICATION RIG ONLY (PR #13163 R5): the open review thread R6-2 on the late-rename guard, driven on the real stack.
// K1 "Alpha" fails at the Harness (retired, FAILED); K2 "Bravo" completes (title Bravo). Then two same-key K1 retries
// overlap: retry #1 revives K1 to PENDING and its Harness call is delayed; retry #2 joins the PENDING row, its Harness
// call fails and retires K1 again. Retry #1's Harness write then lands. What does each caller get, and do the public
// SQL title and the Harness's own journal title agree?
// usage: DB=<db> node r62-rename-race.mjs <bound|unbound> <workspace> <storage>
import { api, sql, one, register, waitTurn, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const r = new Report(`r62-rename-race-${KIND}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=r.txt tag=r0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const T = `/session/${S}/title`;
const cmds = () => sql(`SELECT idempotency_key, command_status FROM managed_agent_command WHERE session_id='${S}' AND operation='RENAME_SESSION' ORDER BY created_at`).map((x) => `${x[0].startsWith('k1') ? 'K1' : 'K2'}:${x[1]}`);
const sqlTitle = () => one(`SELECT COALESCE(title,'') FROM managed_agent_session WHERE session_id='${S}'`);
const harnessTitles = () => sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${S}' AND CAST(inline_bytes AS CHAR) LIKE '%titleSource%' ORDER BY created_at`).map((x) => { try { const o = JSON.parse(x[0]); return `${o.title}@r${o.revision}`; } catch { return String(x[0]).slice(0, 60); } });
const K1 = `k1-${stamp}`, K2 = `k2-${stamp}`;
const rename = (title, key) => api('PATCH', `/v1/agents/sessions/${S}`, { title }, { actor: 'alice', key, timeoutMs: 60_000 });
setTapRules([{ match: `POST ${T}$`, action: 'respond', status: 500, body: { error: { code: 'rig_refusal', message: 'rig' } }, times: 1 }]);
await sleep(300);
const a = await rename('Alpha', K1);
r.note('1. K1 "Alpha", Harness answers 500', `${a.status} ${a.json.error?.code ?? a.json.metadata?.title}; rows ${j(cmds())}`);
setTapRules([]);
await sleep(300);
const b = await rename('Bravo', K2);
r.note('2. K2 "Bravo"', `${b.status} ${b.json.error?.code ?? b.json.metadata?.title}; rows ${j(cmds())}; SQL title=${sqlTitle()}`);
setTapRules([{ match: `POST ${T}$`, action: 'delay', delayMs: 4000, times: 1 }, { match: `POST ${T}$`, action: 'respond', status: 500, body: { error: { code: 'rig_refusal', message: 'rig' } }, times: 1 }]);
await sleep(300);
const p1 = rename('Alpha', K1);
await sleep(700);
const rowsMid = cmds();
const p2 = rename('Alpha', K1);
const [x1, x2] = await Promise.all([p1, p2]);
setTapRules([]);
r.note('3. K1 retry #1 (Harness call delayed 4 s)', `${x1.status} ${x1.json.error?.code ?? x1.json.metadata?.title}`);
r.note('4. K1 retry #2, overlapping (Harness answers 500)', `${x2.status} ${x2.json.error?.code ?? x2.json.metadata?.title}; rows while #1 was in flight ${j(rowsMid)}`);
await sleep(1000);
const calls = tapEntries().filter((e) => e.path === T).map((e) => `${e.fault ?? 'pass'}:${e.status ?? '-'}`);
const ht = harnessTitles();
r.note('POST /title calls at the Harness', j(calls));
r.note('final: rows / public SQL title / Harness journal titles (in order)', `${j(cmds())} / ${sqlTitle()} / ${j(ht)}`);
const get = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const retry3 = await rename('Alpha', K1);
r.note('5. K1 retried once more after the race', `${retry3.status} ${retry3.json.error?.code ?? retry3.json.metadata?.title}; SQL title=${sqlTitle()}; public GET title=${get.json.metadata?.title ?? get.json.title}`);
const ev = sql(`SELECT event_type, COALESCE(source_key,'') FROM managed_agent_event WHERE session_id='${S}' AND event_type LIKE 'session.%' ORDER BY sequence_id`).map((x) => `${x[0]} ${x[1].replace(stamp, '*')}`);
r.note('session.* events', j(ev));
r.done({ session: S, kind: KIND, a: [a.status, a.json.error?.code], b: [b.status, b.json.metadata?.title], retry1: [x1.status, x1.json.error?.code ?? x1.json.metadata?.title], retry2: [x2.status, x2.json.error?.code], calls, sqlTitle: sqlTitle(), harnessTitles: ht, retry3: [retry3.status, retry3.json.error?.code ?? retry3.json.metadata?.title], ev });
process.exit(0);
