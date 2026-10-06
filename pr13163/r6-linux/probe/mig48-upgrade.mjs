// VERIFICATION RIG ONLY (PR #13163 R6): V47+V48 applied by a rolling upgrade on real MySQL 8. Phase "before" runs on
// the previous head's jar: K1 "Alpha" fails at the Harness (FAILED receipt, written before the column existed) and K2
// "Bravo" completes. Replica A is then restarted on the new jar (Flyway runs there; the Store replica keeps the old
// jar). Phase "after" checks the schema history and the legacy rows, then drives the R6-2 race on the legacy K1 row.
// usage: DB=<db> node mig48-upgrade.mjs <before|after> <workspace> <storage>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, setTapRules, tapEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [PHASE, WS, ST] = process.argv.slice(2);
const r = new Report(`mig48-${PHASE}-${WS}`);
const F = `${RUN}/mig48-${WS}.json`;
const flyway = () => sql(`SELECT version, success, COALESCE(checksum,'') FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank DESC LIMIT 3`).map((x) => `V${x[0]}:${x[1] === '1' ? 'ok' : 'FAILED'}`);
const hasCol = () => one(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='managed_agent_command' AND column_name='mutation_attempt_sequence'`) === '1';
const fail500 = (T) => ({ match: `POST ${T}$`, action: 'respond', status: 500, body: { error: { code: 'rig_refusal', message: 'rig' } }, times: 1 });
if (PHASE === 'before') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=m.txt tag=m0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
  const S = c.json.id;
  r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
  const T = `/session/${S}/title`;
  setTapRules([fail500(T)]);
  await sleep(300);
  const a = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: `k1-${stamp}` });
  setTapRules([]);
  await sleep(300);
  const b = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Bravo' }, { actor: 'alice', key: `k2-${stamp}` });
  r.note('old jar: schema', `${j(flyway())}; mutation_attempt_sequence column present=${hasCol()}`);
  r.note('old jar: K1 "Alpha" (Harness 500) / K2 "Bravo"', `${a.status} ${a.json.error?.code ?? ''} / ${b.status} ${b.json.metadata?.title}`);
  r.note('old jar: command rows', j(sql(`SELECT LEFT(idempotency_key,2), command_status FROM managed_agent_command WHERE session_id='${S}' AND operation='RENAME_SESSION' ORDER BY created_at`)));
  fs.writeFileSync(F, JSON.stringify({ S, stamp }));
  r.done({ phase: PHASE, S, a: a.status, b: b.status, flyway: flyway(), col: hasCol() });
  process.exit(0);
}
const { S, stamp } = JSON.parse(fs.readFileSync(F, 'utf8'));
const T = `/session/${S}/title`;
const K1 = `k1-${stamp}`;
const rows = () => sql(`SELECT LEFT(idempotency_key,2), command_status, COALESCE(mutation_attempt_sequence,'null') FROM managed_agent_command WHERE session_id='${S}' AND operation='RENAME_SESSION' ORDER BY created_at`).map((x) => `${x[0].toUpperCase()}:${x[1]}@${x[2]}`);
const harnessTitles = () => sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${S}' AND CAST(inline_bytes AS CHAR) LIKE '%titleSource%' ORDER BY created_at`).map((x) => { try { const o = JSON.parse(x[0]); return `${o.title}@r${o.revision}`; } catch { return '?'; } });
const sqlTitle = () => one(`SELECT COALESCE(title,'') FROM managed_agent_session WHERE session_id='${S}'`);
r.check('new jar: V47 and V48 applied', flyway().slice(0, 2).join() === 'V48:ok,V47:ok', j(flyway()));
r.check('new jar: mutation_attempt_sequence column present', hasCol(), j(sql(`SELECT column_type, is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='managed_agent_command' AND column_name='mutation_attempt_sequence'`)));
r.note('legacy rows after the upgrade', j(rows()));
// The restarted replica's first non-passive load meets the old replica's attachment (409 hosted_session_already_attached,
// API 503) until that attachment lapses; wait it out so the race below measures the receipt, not the reattach.
const W8 = Number(process.env.WAIT_MS ?? 0);
if (W8) { await sleep(W8); r.note('waited for the old attachment to lapse', `${W8} ms`); }
setTapRules([{ match: `POST ${T}$`, action: 'delay', delayMs: 4000, times: 1 }, fail500(T)]);
await sleep(300);
const p1 = api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: K1, timeoutMs: 60_000 });
await sleep(700);
const rowsMid = rows();
const x2 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Alpha' }, { actor: 'alice', key: K1, timeoutMs: 60_000 });
const x1 = await p1;
setTapRules([]);
await sleep(1000);
r.note('legacy K1 retry #1 (Harness call delayed 4 s)', `${x1.status} ${x1.json.error?.code ?? x1.json.metadata?.title}; rows while in flight ${j(rowsMid)}`);
r.note('legacy K1 retry #2, overlapping (Harness 500)', `${x2.status} ${x2.json.error?.code ?? x2.json.metadata?.title}`);
r.check('newest K1 attempt completes on the legacy receipt', x1.status === 200 && x1.json.metadata?.title === 'Alpha', `${x1.status}`);
r.note('final rows / SQL title / Harness titles', `${j(rows())} / ${sqlTitle()} / ${j(harnessTitles())}`);
const c3 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'Charlie' }, { actor: 'alice', key: `k3-${stamp}` });
r.check('a fresh rename after the upgrade', c3.status === 200 && c3.json.metadata?.title === 'Charlie', `${c3.status} ${c3.json.metadata?.title ?? c3.json.error?.code}; rows ${j(rows())}`);
const calls = tapEntries().filter((e) => e.path === T).map((e) => `${e.fault ?? 'pass'}:${e.status ?? '-'}`);
r.note('POST /title calls at the Harness (both phases)', j(calls));
r.done({ phase: PHASE, S, flyway: flyway(), x1: [x1.status, x1.json.error?.code ?? x1.json.metadata?.title], x2: [x2.status, x2.json.error?.code], rows: rows(), sql: sqlTitle(), harness: harnessTitles(), c3: c3.status, calls });
process.exit(0);
