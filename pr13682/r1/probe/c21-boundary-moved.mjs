// VERIFICATION RIG ONLY (PR #13682, round 7): round 6's V48 finding. K1 attempt #1 reaches the Harness but its
// answer is held (tap delay-after); attempt #2 (same key) is refused (500) and retires K1; K2 "Bravo" completes;
// attempt #3 (same key) revives K1 and is refused again; then #1's answer arrives. What does #1 answer, and do the
// database and the Harness agree on the title?
// usage: DB=<db> node c21-boundary-moved.mjs <bound|unbound> <workspace> <storage>
import { api, one, register, waitTurn, setTapRules, tapEntries, sql, Report, sleep, TENANT, j } from './lib.mjs';
import { harnessTitle, journalTitles } from './lib13682.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const r = new Report(`c21-boundary-moved-${KIND}`);
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
const rules = async (x) => { setTapRules(x); await sleep(400); };
await rules([{ match: `POST ${path}`, action: 'delay-after', delayMs: 7000, times: 1 }, refuse]);
const p1 = api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: K1, timeoutMs: 30_000 });
await sleep(700);
const a2 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: K1 });
const rowAfter2 = row();
await rules([]);
const k2 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Bravo' }, { actor: 'alice', key: `k2-${stamp}` });
await rules([refuse]);
const a3 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: K1 });
const rowAfter3 = row();
await rules([]);
const a1 = await p1;
await sleep(1000);
const pub = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const calls = tapEntries().filter((e) => e.path === path && e.method === 'POST').map((e) => ({ t: e.t, title: e.body?.title, fault: e.fault ?? null, status: e.status ?? null }));
// The tap stamps arrival; a delay-after call reached the Harness at arrival, so arrival order is the Harness's order.
const applied = calls.filter((x) => x.status === 200).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
r.note('#1 K1 → Alpha (reaches the Harness, answer held 7 s)', `${a1.status} ${a1.json.error?.code ?? a1.json.metadata?.title}`);
r.note('#2 K1 → Alpha (Harness 500)', `${a2.status} ${a2.json.error?.code ?? ''}; K1 row ${rowAfter2}`);
r.note('K2 → Bravo', `${k2.status} ${k2.json.error?.code ?? k2.json.metadata?.title}`);
r.note('#3 K1 → Alpha after Bravo (Harness 500)', `${a3.status} ${a3.json.error?.code ?? ''}; K1 row ${rowAfter3}`);
r.note('database title afterwards', `${pub.json.metadata?.title}`);
r.note('Harness journal title afterwards (Session Store)', `${harnessTitle(S)}; records ${j(journalTitles(S).map((x) => `${x.title}@${x.managedRenameRevision ?? '-'}`))}`);
const harnessAfter = harnessTitle(S);
r.note('title calls the Harness applied, in arrival order', j(applied.map((x) => x.title)));
r.note('Harness title calls with faults', j(calls.map((x) => `${x.title}:${x.fault ?? '-'}:${x.status ?? '-'}`)));
const a4 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: K1 });
await sleep(500);
const pub4 = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const after4 = tapEntries().filter((e) => e.path === path && e.method === 'POST').length;
r.note('#4 K1 → Alpha once more (no fault)', `${a4.status} ${a4.json.error?.code ?? a4.json.metadata?.title}; database ${pub4.json.metadata?.title}; Harness title calls now ${after4} (was ${calls.length})`);
r.done({ harnessAfter, harnessEnd: harnessTitle(S), session: S, kind: KIND, a1: [a1.status, a1.json.error?.code ?? a1.json.metadata?.title], a2: [a2.status, a2.json.error?.code], k2: [k2.status], a3: [a3.status, a3.json.error?.code], dbTitle: pub.json.metadata?.title, harnessApplied: applied.map((x) => x.title), a4: [a4.status, a4.json.metadata?.title], dbAfter4: pub4.json.metadata?.title, harnessCallsAfter4: after4 });
process.exit(0);
