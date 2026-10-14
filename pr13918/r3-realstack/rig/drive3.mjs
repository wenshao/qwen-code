// PR #13918 scenario driver (round 3, 32-table schema #14069): talks to a running `node rig.mjs serve <arm> <db>` stack
// through Spring's public API only, and holds the tenant guard rows from a separate
// mysql client session (the way a fat lifecycle transaction would).
// Usage: node drive.mjs <db> <scenario> [k=v ...]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const RIG = '/Users/wenshao/pr13918-rig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const [dbName, scenario, ...kv] = process.argv.slice(2);
const opts = Object.fromEntries(kv.map((x) => x.split('=')));
const st = JSON.parse(fs.readFileSync(`${RIG}/state/serve-${dbName}.json`, 'utf8'));
const T = st.tenant;
const DB = st.db;
const OUT = `${RIG}/results/${dbName}`;
fs.mkdirSync(OUT, { recursive: true });
const TAG = `${scenario}${opts.tag ? '-' + opts.tag : ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const rel = (t = Date.now()) => +((t - t0) / 1000).toFixed(2);
const logLines = [];
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} +${rel()}s ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  console.log(line);
  logLines.push(line);
};

function sql(query) {
  const r = spawnSync(MYSQL, ['--protocol=tcp', '-h127.0.0.1', `-P${process.env.DBPORT ?? 23918}`, '-uroot', '--batch', '--skip-column-names', '--raw', DB, '-e', query], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sql: ${r.stderr}`);
  return r.stdout.trim() ? r.stdout.trim().split('\n').map((l) => l.split('\t')) : [];
}
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;

async function api(method, p, body, key) {
  const headers = { 'x-qwen-tenant-id': T, 'X-Qwen-Actor-Id': 'alice', accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const started = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${st.springPort}${p}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(Number(opts.httpTimeout ?? 150000)) });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text: text.slice(0, 400), ms: Date.now() - started };
  } catch (e) {
    return { status: 0, error: String(e), ms: Date.now() - started };
  }
}
const uid = () => Math.random().toString(16).slice(2, 10);
const input = (text) => [{ type: 'input_text', text }];

async function createSession(text, ws = 'W1') {
  const r = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: input(text), workspace: { workspace_id: ws, cwd_relative: 'docs' } }, `create-${uid()}`);
  return { ...r, sessionId: r.json?.id, turnId: r.json?.active_turn_id ?? r.json?.activeTurnId ?? r.json?.active_turn?.id };
}
async function postTurn(sessionId, text) {
  const r = await api('POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: input(text) }, `turn-${uid()}`);
  return { ...r, turnId: r.json?.turn_id ?? r.json?.turnId };
}
function turns(sessionId) {
  return sql(`SELECT turn_id, status, COALESCE(error_code,''), created_at, updated_at FROM ma_turn WHERE tenant_id=${q(T)} AND session_id=${q(sessionId)} ORDER BY created_at`);
}
const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'completed', 'failed', 'cancelled'];
async function waitTurn(sessionId, turnId, timeoutMs) {
  const start = Date.now();
  for (;;) {
    const rows = turns(sessionId);
    const row = turnId ? rows.find((r) => r[0] === turnId) : rows.at(-1);
    if (row && TERMINAL.includes(row[1])) return { turnId: row[0], status: row[1], error: row[2], doneAt: rel(), waitedMs: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { turnId: row?.[0], status: row?.[1] ?? 'none', error: row?.[2], doneAt: rel(), waitedMs: Date.now() - start, timeout: true };
    await sleep(250);
  }
}
async function modelCalls() {
  const r = await fetch(`http://127.0.0.1:${st.controlPort}/model`);
  return (await r.json()).filter((c) => c.turnCall);
}
const callsFor = (calls, marker) => calls.filter((c) => c.marker === marker);

// ---- guard hold from an independent mysql session ----
// ManagedSchemaKeys.key(tenant): SHA-256 over (int32 BE length, UTF-8 bytes); both guard domains share it.
const TKEY = (() => { const b = Buffer.from(T, 'utf8'); const l = Buffer.alloc(4); l.writeInt32BE(b.length); return createHash('sha256').update(l).update(b).digest('hex'); })();
function guardKeysPresent() {
  const rows = sql(`SELECT guard_domain, tenant_key = ${q(TKEY)} FROM ma_tenant_guard WHERE tenant_id=${q(T)} ORDER BY guard_domain`);
  return Object.fromEntries(rows.map(([d, ok]) => [d, ok === '1' ? 'present' : 'KEY-MISMATCH']));
}
// Same statement shape as the product's acquisitions (INSERT … ON DUPLICATE KEY UPDATE, then a
// primary-key FOR UPDATE), so a row that does not exist yet is created and held, as a lifecycle
// transaction would.
function startHold(kind, seconds) {
  const stmts = ['START TRANSACTION'];
  const take = (domain) => {
    stmts.push(`INSERT INTO ma_tenant_guard (tenant_key, tenant_id, guard_domain) VALUES (${q(TKEY)}, ${q(T)}, '${domain}') ON DUPLICATE KEY UPDATE tenant_key = tenant_key`);
    stmts.push(`SELECT 'held-${domain}', tenant_id FROM ma_tenant_guard WHERE tenant_key=${q(TKEY)} AND guard_domain='${domain}' FOR UPDATE`);
  };
  if (kind === 'both' || kind === 'placement') take('runtime_placement');
  if (kind === 'both' || kind === 'publication') take('output_publication');
  stmts.push(`SELECT 'holding', NOW(6)`, `SELECT SLEEP(${seconds})`, 'ROLLBACK', `SELECT 'released', NOW(6)`);
  const child = spawn(MYSQL, ['--protocol=tcp', '-h127.0.0.1', `-P${process.env.DBPORT ?? 23918}`, '-uroot', '--batch', '--unbuffered', '--skip-column-names', DB, '-e', stmts.join('; ')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((r) => child.on('exit', (code) => r({ code, out })));
  return { child, done, outNow: () => out };
}
// Lock-wait sampler: who waits on which table.
function startSampler() {
  const samples = [];
  let stop = false;
  (async () => {
    while (!stop) {
      try {
        const rows = sql(`SELECT w.OBJECT_NAME, COUNT(*) FROM performance_schema.data_lock_waits x JOIN performance_schema.data_locks w ON w.ENGINE_LOCK_ID = x.REQUESTING_ENGINE_LOCK_ID WHERE w.OBJECT_SCHEMA = DATABASE() GROUP BY w.OBJECT_NAME`);
        const waits = Object.fromEntries(rows.map(([t, n]) => [t, Number(n)]));
        const trx = Number(sql(`SELECT COUNT(*) FROM information_schema.innodb_trx t JOIN information_schema.processlist p ON p.ID = t.trx_mysql_thread_id WHERE t.trx_state='LOCK WAIT' AND p.DB = DATABASE()`)[0][0]);
        samples.push({ t: rel(), trx, waits });
      } catch {}
      await sleep(250);
    }
  })();
  return { stop: () => { stop = true; return samples; } };
}
function harnessLogSince(sinceIso, pattern) {
  const f = `${st.runDir}/harness.log`;
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => pattern.test(l));
}

async function warmSession(label, text) {
  const c = await createSession(text);
  if (c.status !== 202) throw new Error(`${label} create ${c.status} ${c.text}`);
  const w = await waitTurn(c.sessionId, undefined, 90000);
  log(`${label}.warm`, c.sessionId, w.status, w.error, `${w.waitedMs}ms`);
  if (w.status !== 'COMPLETED') throw new Error(`${label} warm turn ${w.status}`);
  return c.sessionId;
}

async function scenarioHold() {
  const kind = opts.kind ?? 'both';
  const holdSec = Number(opts.hold ?? 60);
  const result = { scenario: 'hold', arm: st.arm, kind, holdSec, tenant: T, startedAt: new Date().toISOString() };
  const V = await warmSession('victim', `RIG_TEXT_v${uid()} warm`);
  const VT = await warmSession('victimTool', `RIG_TOOL_w${uid()} warm`);
  result.guardRows = guardKeysPresent();
  log('guardRows', result.guardRows);
  const sampler = startSampler();
  const hold = startHold(kind, holdSec);
  for (let i = 0; i < 40 && !/holding/.test(hold.outNow()); i++) await sleep(100);
  const holdAt = Date.now();
  log('hold.started', kind, holdSec, hold.outNow().trim().split('\n'));
  const mText = `RIG_TEXT_t${uid()}`;
  const mTool = `RIG_TOOL_x${uid()}`;
  const mNew = `RIG_TEXT_n${uid()}`;
  const since = (t) => +((t - holdAt) / 1000).toFixed(2);
  const ops = {
    textTurn: (async () => { const a = await postTurn(V, `${mText} during hold`); const at = Date.now(); log('textTurn.admit', a.status, a.json?.turn_id ?? a.text, `${a.ms}ms`); const w = a.turnId ? await waitTurn(V, a.turnId, holdSec * 1000 + 150000) : null; return { admit: { status: a.status, ms: a.ms, code: a.json?.error?.code ?? a.json?.code }, admitAt: since(at), turn: w, doneSinceHold: w ? since(Date.now()) : null }; })(),
    toolTurn: (async () => { const a = await postTurn(VT, `${mTool} during hold`); const at = Date.now(); log('toolTurn.admit', a.status, a.json?.turn_id ?? a.text, `${a.ms}ms`); const w = a.turnId ? await waitTurn(VT, a.turnId, holdSec * 1000 + 150000) : null; return { admit: { status: a.status, ms: a.ms, code: a.json?.error?.code ?? a.json?.code }, admitAt: since(at), turn: w, doneSinceHold: w ? since(Date.now()) : null }; })(),
    newSession: (async () => { const c = await createSession(`${mNew} create during hold`); const at = Date.now(); log('newSession.admit', c.status, c.sessionId ?? c.text, `${c.ms}ms`); const w = c.sessionId ? await waitTurn(c.sessionId, undefined, holdSec * 1000 + 150000) : null; return { sessionId: c.sessionId, admit: { status: c.status, ms: c.ms, code: c.json?.error?.code ?? c.json?.code, body: c.status !== 202 ? c.text : undefined }, admitAt: since(at), turn: w, doneSinceHold: w ? since(Date.now()) : null }; })(),
  };
  const settled = Object.fromEntries(await Promise.all(Object.entries(ops).map(async ([k, p]) => [k, await p])));
  const held = await hold.done;
  result.holdOutput = held.out.trim().split('\n');
  const samples = sampler.stop();
  result.lockWaits = { maxTrx: Math.max(0, ...samples.map((s) => s.trx)), byTable: samples.reduce((m, s) => { for (const [t, n] of Object.entries(s.waits)) m[t] = Math.max(m[t] ?? 0, n); return m; }, {}) };
  const calls = await modelCalls();
  for (const [k, m] of [['textTurn', mText], ['toolTurn', mTool], ['newSession', mNew]]) {
    const c = callsFor(calls, m);
    settled[k].modelCalls = c.length;
    settled[k].firstModelCallSinceHold = c.length ? since(Date.parse(c[0].t)) : null;
  }
  result.during = settled;
  log('during', settled);
  // After the hold: does every Session take a new turn again?
  await sleep(1000);
  const after = {};
  for (const [k, sid] of [['victim', V], ['victimTool', VT], ['newSession', settled.newSession.sessionId]]) {
    if (!sid) { after[k] = { skipped: 'no session' }; continue; }
    const m = k === 'victimTool' ? `RIG_TOOL_a${uid()}` : `RIG_TEXT_a${uid()}`;
    const a = await postTurn(sid, `${m} after hold`);
    const w = a.turnId ? await waitTurn(sid, a.turnId, 120000) : null;
    const c = callsFor(await modelCalls(), m).length;
    after[k] = { admit: { status: a.status, ms: a.ms, code: a.json?.error?.code ?? a.json?.code, body: a.status >= 300 ? a.text : undefined }, turn: w, modelCalls: c };
    log(`after.${k}`, after[k]);
  }
  // A brand-new Session after the hold (the half-inserted head row symptom).
  const c2 = await createSession(`RIG_TEXT_z${uid()} create after hold`);
  const w2 = c2.sessionId ? await waitTurn(c2.sessionId, undefined, 120000) : null;
  after.freshCreate = { admit: { status: c2.status, ms: c2.ms, code: c2.json?.error?.code ?? c2.json?.code }, turn: w2 };
  log('after.freshCreate', after.freshCreate);
  result.after = after;
  result.harnessNamed = harnessLogSince(result.startedAt, /tenant_guard_contended|managed_session_store_unavailable|aborted due to timeout|failed after \d attempts|could not settle|recovery remained blocked/).slice(-40);
  result.log = logLines;
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(result, null, 2));
  log('WROTE', `${OUT}/${TAG}.json`);
}

async function scenarioSmoke() {
  const V = await warmSession('smoke', `RIG_TEXT_s${uid()} hello`);
  const VT = await warmSession('smokeTool', `RIG_TOOL_s${uid()} hello`);
  const calls = await modelCalls();
  log('smoke.done', { V, VT, guardRows: guardKeysPresent(), calls: calls.slice(-4).map((c) => [c.marker, c.toolResults]) });
  log('turns', turns(VT));
}


async function heldMarkers() {
  const r = await fetch(`http://127.0.0.1:${st.controlPort}/held`);
  return r.json();
}
async function releaseModel() {
  const r = await fetch(`http://127.0.0.1:${st.controlPort}/release`);
  return r.json();
}
function headRow(sid) {
  const r = sql(`SELECT writer_generation, DATE_FORMAT(writer_lease_until,'%H:%i:%s.%f'), recovery_status, journal_revision, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), writer_lease_until)/1000000 FROM ma_session_head WHERE head_kind='MANAGED_SESSION' AND tenant_id=${q(T)} AND session_id=${q(sid)}`)[0];
  return r ? { gen: r[0], leaseUntil: r[1], recovery: r[2], rev: Number(r[3]), leaseLeftSec: Number(r[4]) } : null;
}
function springLogSince(iso, pattern) {
  const f = `${st.runDir}/spring.log`;
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.slice(0, 23) >= iso.slice(0, 23) && pattern.test(l)).map((l) => l.slice(0, 600));
}

// The hold lands mid-turn: Spring has admitted the turn and the Harness is inside the
// model call (after hostedModelAttempt); releasing the model makes the Harness commit
// the assistant message / tool records / turn result against the held guard rows.
async function scenarioInflight() {
  const kind = opts.kind ?? 'both';
  const holdSec = Number(opts.hold ?? 60);
  const releaseAfter = Number(opts.releaseAfter ?? 1);
  const result = { scenario: 'inflight', arm: st.arm, kind, holdSec, releaseAfter, tenant: T, startedAt: new Date().toISOString() };
  const V = await warmSession('victim', `RIG_TEXT_v${uid()} warm`);
  const VT = await warmSession('victimTool', `RIG_TOOL_w${uid()} warm`);
  const VI = await warmSession('idle', `RIG_TEXT_i${uid()} warm`);
  const mText = `RIG_HOLD_t${uid()}`;
  const mTool = `RIG_HOLDT_x${uid()}`;
  const aText = await postTurn(V, `${mText} mid-turn`);
  const aTool = await postTurn(VT, `${mTool} mid-turn`);
  log('admitted', aText.status, aText.turnId, aTool.status, aTool.turnId);
  for (let i = 0; i < 100; i++) { const h = await heldMarkers(); if (h.includes(mText) && h.includes(mTool)) break; await sleep(100); }
  log('model.held', await heldMarkers());
  result.headsBefore = { V: headRow(V), VT: headRow(VT), VI: headRow(VI) };
  result.guardRowsBefore = guardKeysPresent();
  log('guardRowsBefore', result.guardRowsBefore);
  const sampler = startSampler();
  const leaseSamples = [];
  let sampling = true;
  (async () => { while (sampling) { leaseSamples.push({ t: rel(), VI: headRow(VI)?.leaseLeftSec, V: headRow(V)?.leaseLeftSec }); await sleep(1000); } })();
  const hold = startHold(kind, holdSec);
  for (let i = 0; i < 40 && !/holding/.test(hold.outNow()); i++) await sleep(100);
  const holdAt = Date.now();
  const since = (t) => +((t - holdAt) / 1000).toFixed(2);
  log('hold.started', kind, holdSec);
  await sleep(releaseAfter * 1000);
  log('model.release', await releaseModel());
  const releasedAt = Date.now();
  const [wText, wTool] = await Promise.all([
    waitTurn(V, aText.turnId, holdSec * 1000 + Number(opts.settleTimeout ?? 120000)).then((w) => ({ ...w, doneSinceHold: since(Date.now()) })),
    waitTurn(VT, aTool.turnId, holdSec * 1000 + Number(opts.settleTimeout ?? 120000)).then((w) => ({ ...w, doneSinceHold: since(Date.now()) })),
  ]);
  log('text.turn', wText);
  log('tool.turn', wTool);
  const held = await hold.done;
  const holdEndedSinceHold = since(Date.now());
  sampling = false;
  const samples = sampler.stop();
  result.holdOutput = held.out.trim().split('\n');
  result.holdEndedSinceHold = holdEndedSinceHold;
  result.lockWaits = { maxTrx: Math.max(0, ...samples.map((s) => s.trx)), byTable: samples.reduce((m, s) => { for (const [t, n] of Object.entries(s.waits)) m[t] = Math.max(m[t] ?? 0, n); return m; }, {}) };
  result.lockWaitSeries = samples.filter((_, i) => i % 4 === 0);
  result.leaseSamples = leaseSamples;
  const calls = await modelCalls();
  result.during = {
    textTurn: { admit: aText.status, turn: wText, modelCalls: callsFor(calls, mText).length },
    toolTurn: { admit: aTool.status, turn: wTool, modelCalls: callsFor(calls, mTool).length, toolFollowUps: callsFor(calls, mTool).filter((c) => c.toolResults > 0).length },
  };
  result.headsAfterHold = { V: headRow(V), VT: headRow(VT), VI: headRow(VI) };
  log('heads.afterHold', result.headsAfterHold);
  await sleep(2000);
  const after = {};
  for (const [k, sid] of [['victim', V], ['victimTool', VT], ['idle', VI]]) {
    const m = k === 'victimTool' ? `RIG_TOOL_a${uid()}` : `RIG_TEXT_a${uid()}`;
    const a = await postTurn(sid, `${m} after hold`);
    const w = a.turnId ? await waitTurn(sid, a.turnId, Number(opts.afterTimeout ?? 120000)) : null;
    after[k] = { admit: { status: a.status, ms: a.ms, code: a.json?.error?.code }, turn: w, modelCalls: callsFor(await modelCalls(), m).length };
    log(`after.${k}`, after[k]);
  }
  result.after = after;
  result.harnessLines = harnessLogSince(result.startedAt, /tenant_guard_contended|managed_session_store_unavailable|aborted due to timeout|failed after \d attempts|could not settle|could not finish|recovery remained blocked|writer|store_unavailable|hosted_prompt_admission_failed|status=5\d\d/).slice(-60).map((l) => l.slice(0, 500));
  result.springLines = springLogSince(result.startedAt, /WARN|ERROR/).slice(-40);
  result.log = logLines;
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(result, null, 2));
  log('WROTE', `${OUT}/${TAG}.json`);
}

async function scenarioIdle() {
  const gaps = (opts.gaps ?? '0,30,90').split(',').map(Number);
  const S = await warmSession('ctl', `RIG_TEXT_c${uid()} warm`);
  const res = [];
  for (const g of gaps) {
    await sleep(g * 1000);
    const m = `RIG_TEXT_g${uid()}`;
    const a = await postTurn(S, `${m} after ${g}s idle`);
    const w = a.turnId ? await waitTurn(S, a.turnId, 60000) : null;
    res.push({ gap: g, admit: a.status, turn: w });
    log('idle', g, a.status, w?.status, w?.waitedMs);
  }
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ scenario: 'idle', arm: st.arm, session: S, res, log: logLines }, null, 2));
}

// N Sessions created at once (writer acquisition + commits), then one more turn each,
// all concurrently: the store's transaction count tracks the Druid pool size.
async function scenarioBurst() {
  const n = Number(opts.n ?? 16);
  const res = { scenario: 'burst', arm: st.arm, n, pool: st.pool, startedAt: new Date().toISOString() };
  // MariaDB exposes Innodb_deadlocks; MySQL 8.4 only has the INNODB_METRICS lock_deadlocks counter.
  const deadlocks = () => Number(sql("SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'")[0]?.[1] ?? sql("SELECT COUNT FROM information_schema.INNODB_METRICS WHERE NAME='lock_deadlocks'")[0]?.[0] ?? NaN);
  res.innodbDeadlocksBefore = deadlocks();
  const startAll = Date.now();
  const sessions = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const c = await createSession(`RIG_TEXT_b${i}x${uid()} burst create`);
    const w = c.sessionId ? await waitTurn(c.sessionId, undefined, Number(opts.turnTimeout ?? 150000)) : null;
    return { i, create: { status: c.status, ms: c.ms, code: c.json?.error?.code }, sessionId: c.sessionId, first: w };
  }));
  res.createPhaseSec = (Date.now() - startAll) / 1000;
  const startTurns = Date.now();
  const second = await Promise.all(sessions.map(async (x) => {
    if (!x.sessionId) return { skipped: true };
    const a = await postTurn(x.sessionId, `RIG_TEXT_c${x.i}x${uid()} burst turn`);
    const w = a.turnId ? await waitTurn(x.sessionId, a.turnId, Number(opts.turnTimeout ?? 150000)) : null;
    return { admit: { status: a.status, ms: a.ms, code: a.json?.error?.code }, turn: w };
  }));
  res.turnPhaseSec = (Date.now() - startTurns) / 1000;
  const summarize = (arr) => {
    const by = {};
    for (const x of arr) { const k = x ? `${x.status}${x.error ? ':' + x.error : ''}${x.timeout ? ':timeout' : ''}` : 'no-turn'; by[k] = (by[k] ?? 0) + 1; }
    const ms = arr.filter((x) => x && x.status === 'COMPLETED').map((x) => x.waitedMs).sort((a, b) => a - b);
    return { outcomes: by, p50: ms[Math.floor(ms.length / 2)] ?? null, max: ms.at(-1) ?? null };
  };
  res.createStatuses = sessions.reduce((m, x) => { m[x.create.status] = (m[x.create.status] ?? 0) + 1; return m; }, {});
  res.firstTurns = summarize(sessions.map((x) => x.first));
  res.secondTurns = summarize(second.map((x) => x.turn));
  res.springLines = springLogSince(res.startedAt, /GetConnectionTimeout|wait millis|v2 probe failed|CannotGetJdbcConnection|tenant_guard_contended|ERROR/).slice(-30);
  res.springCounts = {
    poolTimeout: springLogSince(res.startedAt, /GetConnectionTimeoutException|wait millis/).length,
    v2probe: springLogSince(res.startedAt, /v2 probe failed/).length,
    error: springLogSince(res.startedAt, /ERROR/).length,
  };
  res.harnessLines = harnessLogSince(res.startedAt, /writes stopped|failed after \d attempts|could not settle|status=5\d\d/).slice(-20).map((l) => l.slice(0, 400));
  res.innodbDeadlocksAfter = deadlocks();
  res.springCounts.deadlock = springLogSince(res.startedAt, /Deadlock found|DeadlockLoser|1213/).length;
  res.harnessCounts = { writesStopped: harnessLogSince(res.startedAt, /writes stopped/).length, store5xx: harnessLogSince(res.startedAt, /Managed Session Store .* failed/).length };
  // Recovery probe: one fresh Session once the burst is over.
  await sleep(5000);
  const rc = await createSession(`RIG_TEXT_r${uid()} after burst`);
  const rw = rc.sessionId ? await waitTurn(rc.sessionId, undefined, 90000) : null;
  res.recovery = { create: rc.status, turn: rw };
  log('burst', { recovery: res.recovery });
  log('burst', { create: res.createStatuses, first: res.firstTurns, second: res.secondTurns, createPhaseSec: res.createPhaseSec, turnPhaseSec: res.turnPhaseSec, spring: res.springCounts, harness: res.harnessCounts, innodbDeadlocks: [res.innodbDeadlocksBefore, res.innodbDeadlocksAfter] });
  res.log = logLines;
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(res, null, 2));
}

const scenarios = { hold: scenarioHold, smoke: scenarioSmoke, inflight: scenarioInflight, idle: scenarioIdle, burst: scenarioBurst };
await scenarios[scenario]();
process.exit(0);
