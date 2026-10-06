// VERIFICATION RIG ONLY (PR #13163 R6): the V48 attempt boundary moves on every revival, including a revival that
// then fails. K1 "Alpha" attempt #1 reaches the Harness and its answer is held; attempt #2 (same key) fails and retires
// K1; K2 "Bravo" then completes. K1 attempt #3 (same key, sent after Bravo) revives K1 and fails at the Harness.
// Only then is attempt #1's held answer delivered. Which title wins in SQL and in the Harness, and does a later K1
// retry reconcile them?
// usage: DB=<db> node r63-older-inflight.mjs <bound|unbound> <workspace> <storage>
import { api, sql, one, register, waitTurn, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const r = new Report(`r63-older-inflight-${KIND}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=o.txt tag=o0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const T = `/session/${S}/title`;
const K1 = `k1-${stamp}`, K2 = `k2-${stamp}`;
const hasCol = one(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='managed_agent_command' AND column_name='mutation_attempt_sequence'`) === '1';
const cmds = () => sql(`SELECT idempotency_key, command_status${hasCol ? ", COALESCE(mutation_attempt_sequence,'null')" : ''} FROM managed_agent_command WHERE session_id='${S}' AND operation='RENAME_SESSION' ORDER BY created_at`).map((x) => `${x[0].startsWith('k1') ? 'K1' : 'K2'}:${x[1]}${hasCol ? '@' + x[2] : ''}`);
const sqlTitle = () => one(`SELECT COALESCE(title,'') FROM managed_agent_session WHERE session_id='${S}'`);
const harnessTitles = () => sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${S}' AND CAST(inline_bytes AS CHAR) LIKE '%titleSource%' ORDER BY created_at`).map((x) => { try { const o = JSON.parse(x[0]); return `${o.title}@r${o.revision}`; } catch { return String(x[0]).slice(0, 60); } });
const rename = (title, key) => api('PATCH', `/v1/agents/sessions/${S}`, { title }, { actor: 'alice', key, timeoutMs: 60_000 });
const fail500 = { match: `POST ${T}$`, action: 'respond', status: 500, body: { error: { code: 'rig_refusal', message: 'rig' } }, times: 1 };
setTapRules([{ match: `POST ${T}$`, action: 'delay-after', delayMs: 9000, times: 1 }, fail500]);
await sleep(300);
const t0 = Date.now();
const at = () => `+${Date.now() - t0} ms`;
const p1 = rename('Alpha', K1);
const reached = () => tapEntries().some((e) => e.path === T && e.fault === 'delay-after');
for (let i = 0; i < 100 && !reached(); i++) await sleep(50);
r.note('1. K1 attempt #1 "Alpha": Harness applied it, answer held 9 s', `${reached() ? at() : 'NOT reached'}; rows ${j(cmds())}; Harness titles ${j(harnessTitles())}`);
const x2 = await rename('Alpha', K1);
r.note('2. K1 attempt #2 (same key), Harness answers 500', `${at()} ${x2.status} ${x2.json.error?.code ?? x2.json.metadata?.title}; rows ${j(cmds())}`);
setTapRules([]);
await sleep(300);
const b = await rename('Bravo', K2);
r.note('3. K2 "Bravo"', `${at()} ${b.status} ${b.json.error?.code ?? b.json.metadata?.title}; rows ${j(cmds())}; SQL=${sqlTitle()}; Harness titles ${j(harnessTitles())}`);
setTapRules([fail500]);
await sleep(300);
const x3 = await rename('Alpha', K1);
r.note('4. K1 attempt #3 (same key, sent after Bravo), Harness answers 500', `${at()} ${x3.status} ${x3.json.error?.code ?? x3.json.metadata?.title}; rows ${j(cmds())}`);
setTapRules([]);
const x1 = await p1;
r.note('5. K1 attempt #1 answer delivered', `${at()} ${x1.status} ${x1.json.error?.code ?? x1.json.metadata?.title}`);
await sleep(1000);
const get = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const mid = { rows: cmds(), sql: sqlTitle(), get: get.json.metadata?.title ?? get.json.title, harness: harnessTitles() };
r.note('after the race: rows / SQL title / public GET title / Harness titles', `${j(mid.rows)} / ${mid.sql} / ${mid.get} / ${j(mid.harness)}`);
const x4 = await rename('Alpha', K1);
await sleep(1000);
const end = { rows: cmds(), sql: sqlTitle(), harness: harnessTitles() };
r.note('6. K1 retried once more', `${x4.status} ${x4.json.error?.code ?? x4.json.metadata?.title} replay=${x4.headers['x-qwen-idempotent-replay'] ?? '-'}; rows ${j(end.rows)}; SQL=${end.sql}; Harness titles ${j(end.harness)}`);
const calls = tapEntries().filter((e) => e.path === T).map((e) => `${e.fault ?? 'pass'}:${e.status ?? '-'}`);
r.note('POST /title calls at the Harness', j(calls));
const ev = sql(`SELECT sequence_id, event_type, COALESCE(source_key,'') FROM managed_agent_event WHERE session_id='${S}' AND event_type LIKE 'session.%' ORDER BY sequence_id`).map((x) => `${x[0]} ${x[1]} ${x[2].replace(stamp, '*')}`);
r.note('session.* events', j(ev));
r.done({ session: S, kind: KIND, hasCol, attempt1: [x1.status, x1.json.error?.code ?? x1.json.metadata?.title], attempt2: [x2.status, x2.json.error?.code], k2: [b.status, b.json.metadata?.title], attempt3: [x3.status, x3.json.error?.code], mid, retry: [x4.status, x4.json.error?.code ?? x4.json.metadata?.title, x4.headers['x-qwen-idempotent-replay'] ?? null], end, calls, ev });
process.exit(0);
