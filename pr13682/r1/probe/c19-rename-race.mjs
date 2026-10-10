// VERIFICATION RIG ONLY (PR #13682, round 5): the open review thread on supersededByLaterMutation (R6-2, concurrent
// leg). K1 → A is refused once by the Harness (row FAILED); K2 → B completes; then two retries of K1 overlap: R2's
// Harness call is held 8 s (and succeeds), R3's is refused (500) and retires the row while R2 is still in flight.
// What does R2 answer, which title does the database keep, and which title did the Harness apply last?
// usage: DB=<db> node c19-rename-race.mjs <bound|unbound> <workspace> <storage>
import { api, one, register, waitTurn, setTapRules, tapEntries, sql, Report, sleep, TENANT, j } from './lib.mjs';
import { harnessTitle, journalTitles } from './lib13682.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const r = new Report(`c19-rename-race-${KIND}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=t.txt tag=t0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const path = `/session/${S}/title`;
const K1 = `k1-${stamp}`;
const row = () => sql(`SELECT command_status FROM managed_agent_command WHERE session_id='${S}' AND idempotency_key='${K1}'`)[0]?.[0];
const refuse = { match: `POST ${path}`, action: 'respond', status: 500, body: { error: { code: 'rig_refusal' } }, times: 1 };
setTapRules([refuse]);
await sleep(300);
const r1 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title A' }, { actor: 'alice', key: K1 });
const rowAfterR1 = row();
setTapRules([]);
await sleep(300);
const k2 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title B' }, { actor: 'alice', key: `k2-${stamp}` });
setTapRules([{ match: `POST ${path}`, action: 'delay', delayMs: 8000, times: 1 }, refuse]);
await sleep(300);
const p2 = api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title A' }, { actor: 'alice', key: K1, timeoutMs: 30_000 });
// The tap logs a delayed call only once it has been forwarded and answered, so wait a fixed time instead.
await sleep(1500);
const rowWhileR2Held = row();
const r3 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title A' }, { actor: 'alice', key: K1 });
const rowAfterR3 = row();
const r2 = await p2;
setTapRules([]);
await sleep(1000);
const pub = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const calls = tapEntries().filter((e) => e.path === path && e.method === 'POST').map((e) => ({ t: e.t, title: e.body?.title, fault: e.fault ?? null, status: e.status ?? null }));
const at = (x) => Date.parse(x.t) + (x.fault === 'delay' ? 8000 : 0);
const applied = calls.filter((x) => x.status === 200).sort((a, b) => at(a) - at(b));
r.note('R1 (K1 → A, Harness 500)', `${r1.status} ${r1.json.error?.code ?? r1.json.metadata?.title}; K1 row ${rowAfterR1}`);
r.note('K2 → B', `${k2.status} ${k2.json.error?.code ?? k2.json.metadata?.title}`);
r.note('R2 (K1 → A retry, Harness call held 8 s, then 200)', `${r2.status} ${r2.json.error?.code ?? r2.json.metadata?.title}; K1 row while held ${rowWhileR2Held}`);
r.note('R3 (K1 → A retry overlapping R2, Harness 500)', `${r3.status} ${r3.json.error?.code ?? r3.json.metadata?.title}; K1 row after R3 ${rowAfterR3}`);
r.note('database title afterwards', `${pub.json.metadata?.title}`);
r.note('Harness journal title afterwards (Session Store)', `${harnessTitle(S)}; records ${j(journalTitles(S).map((x) => `${x.title}@${x.managedRenameRevision ?? '-'}`))}`);
const harnessAfter = harnessTitle(S);
r.note('title calls the Harness applied, in order', j(applied.map((x) => x.title)));
r.note('Harness title calls with faults', j(calls.map((x) => `${x.title}:${x.fault ?? '-'}:${x.status ?? '-'}`)));
// A client that got 503 for R3 retries once more with no fault in the way.
const r4 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'title A' }, { actor: 'alice', key: K1 });
const pub4 = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
r.note('R4 (K1 → A once more, no fault)', `${r4.status} ${r4.json.error?.code ?? r4.json.metadata?.title}; database title then ${pub4.json.metadata?.title}; K1 row ${row()}`);
r.done({ harnessAfter, harnessEnd: harnessTitle(S), session: S, kind: KIND, r1: [r1.status, r1.json.error?.code], k2: [k2.status, k2.json.metadata?.title], r2: [r2.status, r2.json.error?.code ?? r2.json.metadata?.title], r3: [r3.status, r3.json.error?.code], dbTitle: pub.json.metadata?.title, harnessApplied: applied.map((x) => x.title), r4: [r4.status, r4.json.error?.code ?? r4.json.metadata?.title], dbTitleAfterR4: pub4.json.metadata?.title });
process.exit(0);
