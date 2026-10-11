// VERIFICATION RIG ONLY (PR #13673): idle files/1 Session with original COMMAND Hooks; DELETE; the tap holds the
// post-effect POST /session/<T>/detach (End and Delete effects are already durable); inject FAULT; restart; observe <=180 s.
// usage: DB=.. ARM=<jar arm> DIST=<dist arm> FAULT=<spring-term|spring-kill|spring-workers|all|reboot> PHASE=<run|prep|resume> node p-recover.mjs
import * as L from './lib.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';

const FAULT = process.env.FAULT ?? 'spring-term';
const PHASE = process.env.PHASE ?? 'run';
const DIST = process.env.DIST ?? L.ARM;
const DEADLINE = Number(process.env.DEADLINE_MS ?? 180_000);
// Round 3: emulate a child-Workspace physical step that wants the same storage (main V60 holdForMaintenance).
const MAINT = Number(process.env.MAINT_HOLD_MS ?? 0);
// Round 4 (yiliang114 review / bot R2-1, R2-2): LOCK=guard|holder holds the tenant placement guard or the storage
// holder row FOR UPDATE for LOCK_MS once the drain claim is DRAINING; FLOCK_MS holds the LocalRuntimeStore file lock
// right after the first reconcile retired the registration. FAULT=workers kills only the two workers (Spring and
// Harness stay up; the detach is gated, not held); RESTART_AFTER_MS then restarts Spring if still not retired.
const LOCK = process.env.LOCK ?? '';
const LOCK_MS = Number(process.env.LOCK_MS ?? 45_000);
const FLOCK = Number(process.env.FLOCK_MS ?? 0);
const RESTART_AFTER = Number(process.env.RESTART_AFTER_MS ?? 0);
const GATE = FAULT === 'workers';
const R = new L.Report(`recover-${FAULT}${MAINT ? '-maint' : ''}${LOCK ? `-lock-${LOCK}` : ''}${FLOCK ? '-flock' : ''}${PHASE === 'resume' ? '-resume' : PHASE === 'prep' ? '-prep' : ''}`);
const STATE = `${L.OUT}/state-${FAULT}.json`;
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const recs = (s) => (fs.existsSync(REC) ? fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s) : []);
const bootId = () => fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const modelCount = () => (fs.existsSync(L.MODEL_LOG) ? fs.readFileSync(L.MODEL_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const rtSessions = (binding) => L.sql('SELECT runtime_session_id AS id, session_state AS state, runtime_generation AS gen, turn_kind AS kind FROM qwen_runtime_session WHERE binding_id=? ORDER BY runtime_session_id', [binding]);
const holderRows = () => L.sql("SELECT storage_id AS st, holder_key IS NOT NULL AS held, binding_id AS b, runtime_generation AS g, runtime_session_id AS rs FROM managed_workspace_execution_lease WHERE storage_kind='LOCAL' ORDER BY storage_id");
const bindingFull = async (s) => (await L.sql("SELECT binding_id AS id, runtime_generation AS gen, binding_state AS state, drain_requested AS drainReq, operation_owner AS owner, operation_generation AS opGen, resource_handle_json AS handle, CONCAT(provision_request_id, '/', SHA2(provision_seed_ciphertext, 256)) AS seed, CONCAT_WS('|', runtime_instance_id, runtime_endpoint, runtime_lease_id, runtime_epoch, SHA2(runtime_credential_ciphertext, 256)) AS lease, IF(drain_receipt_json IS NULL,0,1) AS drainRcpt, drain_receipt_json AS receipt, IF(stop_evidence_json IS NULL,0,1) AS stopEv, IF(loss_evidence_json IS NULL,0,1) AS lossEv FROM qwen_runtime_binding WHERE isolation_key=? ORDER BY runtime_generation", [s]));
const opFull = async (op) => (await L.sql('SELECT state, delivery_state AS delivery, COALESCE(error_code,"") AS err, claim_generation AS gen, attempt_count AS attempts, lifecycle_protocol_version AS proto, lifecycle_effects_receipt_json AS effects FROM managed_agent_operation WHERE operation_id=?', [op]))[0];

async function setup() {
  await L.ensureWorkspace('ws-a', 'st-a');
  await L.ensureWorkspace('ws-z', 'st-f');
  // Warm-up Session in another workspace: the Harness and Broker load their lazy paths before the measured Sessions.
  const wu = await L.createSession('public', 'ws-z', `G_WRITE name=warmup-${Date.now().toString(36)}.txt content=warmup`);
  const wt = await L.waitTurns(wu.session, 1, 180_000);
  R.note('warm-up Session in ws-z', { status: wu.status, turn: wt.rows.at(-1)?.status });
  const nb = await L.createSession('public', 'ws-a', `G_WRITE name=neighbor-${Date.now().toString(36)}.txt content=neighbor`);
  const nt = await L.waitTurns(nb.session, 1);
  R.check('neighbor Session (no Hooks) created in ws-a, first Turn completes', nt.rows.at(-1)?.status === 'COMPLETED', { status: nb.status, turn: nt.rows.at(-1) });
  const pin = JSON.parse(fs.readFileSync(`${L.LOGD}/hook-pin.json`, 'utf8'));
  L.setTapRules([{ match: '^POST /session$', action: 'inject', merge: { hookCatalog: pin }, times: 1 }]);
  const tg = await L.createSession('public', 'ws-a', `G_WRITE name=target-${Date.now().toString(36)}.txt content=target`);
  const tt = await L.waitTurns(tg.session, 1);
  L.setTapRules([]);
  R.check('target Session with original command Hook catalog created in ws-a, first Turn completes', tt.rows.at(-1)?.status === 'COMPLETED', { status: tg.status, turn: tt.rows.at(-1) });
  const T = tg.session, N = nb.session;
  const sr = await L.sessRow(T);
  R.note('target Session row', sr);
  const files = fs.readdirSync(`${L.VARRUN}/ws/a/child`).sort();
  const bytes = Object.fromEntries(files.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(`${L.VARRUN}/ws/a/child/${f}`)).digest('hex').slice(0, 16)]));
  const decoy = fs.existsSync(`${L.VARRUN}/decoy`) ? fs.readdirSync(`${L.VARRUN}/decoy`).length : 0;
  const bT = (await bindingFull(T)).at(-1), bN = (await bindingFull(N)).at(-1);
  const storageKey = await L.one('SELECT storage_key FROM managed_workspace_execution_lease WHERE binding_id=?', [bT.id]);
  const before = {
    T, N, boot: bootId(), files: bytes, decoy, storageKey,
    bindingT: { id: bT.id, gen: bT.gen, state: bT.state, handle: bT.handle, seed: bT.seed, lease: bT.lease },
    bindingN: { id: bN.id, gen: bN.gen, state: bN.state },
    rtT: await rtSessions(bT.id), holders: await holderRows(),
    workerT: await L.workerOf(T), workerN: await L.workerOf(N), models: modelCount(),
  };
  R.note('before: target runtime sessions (original Hook + tool sessions on one binding)', before.rtT);
  R.note('before: storage holders', before.holders);
  R.note('before: workers', { T: before.workerT, N: before.workerN });
  // Hold the post-effect detach of the target only.
  fs.rmSync(`${L.TAP_RULES}.open`, { force: true });
  L.setTapRules([{ match: `^POST /session/${T}/detach$`, action: GATE ? 'gate' : 'hold', times: 1 }]);
  const t0 = L.tapLen();
  const d = await L.del('public', T);
  const op = L.opIdOf('public', d);
  R.note('DELETE accepted', { status: d.status, op });
  const held = await L.waitFor(async () => L.tap().slice(t0).some((e) => e.fault === (GATE ? 'gate' : 'hold') && e.path.includes(T)), 120_000, 200);
  const o = await opFull(op);
  const hk = recs(T);
  R.check('fault point reached: End and Delete command Hooks ran once each, effects durable, detach held by the tap',
    !!held.v && hk.length === 2 && hk[0].event === 'SessionEnd' && hk[1].event === 'SessionDelete' && o?.effects != null,
    { heldAfterMs: held.ms, hooks: hk.map((e) => `${e.event}:${e.phase}:pid${e.pid}:${e.cgroup}`), op: { ...o, effects: o?.effects ? JSON.parse(o.effects).effects?.map((e) => e.event) : null } });
  return { ...before, op, effectsBytes: o?.effects, tapAtHold: L.tapLen() };
}

function inject(before) {
  const out = [];
  const kill9 = (pid, what) => { if (!pid) return; try { process.kill(pid, 'SIGKILL'); out.push(`${what} pid=${pid} SIGKILL`); } catch (e) { out.push(`${what} pid=${pid} ${e.code}`); } };
  if (FAULT === 'spring-term') out.push(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring TERM`, { allowFail: true }).split('\n')[0]);
  if (['spring-kill', 'spring-workers', 'all'].includes(FAULT)) out.push(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring KILL`, { allowFail: true }).split('\n')[0]);
  if (['spring-workers', 'all'].includes(FAULT)) { kill9(before.workerT.pid, 'target worker'); kill9(before.workerN.pid, 'neighbor worker'); }
  if (FAULT === 'all') out.push(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} harness KILL`, { allowFail: true }).split('\n')[0]);
  if (FAULT === 'workers') { kill9(before.workerT.pid, 'target worker'); kill9(before.workerN.pid, 'neighbor worker'); }
  return out;
}

async function restart() {
  const out = [];
  L.setTapRules([]);
  const hp = `${L.VARRUN}/harness.pid`;
  const harnessUp = fs.existsSync(hp) && L.alive(Number(fs.readFileSync(hp, 'utf8')));
  if (!harnessUp || PHASE === 'resume') out.push(L.sh(`${L.RIG}/lx/harness.sh ${L.DB} ${DIST}`, { allowFail: true }).split('\n').at(-1));
  out.push(L.sh(`HOOKS=${L.LOGD}/hooks.json DIST=${DIST} ${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true }).split('\n').at(-1));
  return out;
}

// The row shape, holder key and admission condition of WorkspaceExecutionStore.holdForMaintenance (holder_key IS NULL,
// Runtime columns NULL, maintenance_id set), polled like a step that met workspace_busy; released after MAINT ms by the
// same UPDATE as releaseMaintenance. No qwen_managed_child_workspace row, so releaseStaleMaintenance never touches it.
async function maintenance(before, faultAt, stop) {
  const id = crypto.randomBytes(16).toString('hex');
  const holder = crypto.createHash('sha256').update(`child-workspace\u0000${id}\u0000${1}`).digest('hex');
  const at = () => +((Date.now() - faultAt) / 1000).toFixed(1);
  const log = { maintenanceId: id, storageKey: before.storageKey?.slice(0, 16), polls: 0 };
  for (;;) {
    if (stop.done) { log.taken = null; log.note = 'operation finished before the storage was ever free'; return log; }
    const r = await L.sql("UPDATE managed_workspace_execution_lease SET holder_key=?, binding_id=NULL, runtime_generation=NULL, runtime_session_id=NULL, maintenance_id=? WHERE storage_key=? AND storage_kind='LOCAL' AND holder_key IS NULL", [holder, id, before.storageKey]);
    log.polls++;
    if (r.affectedRows === 1) break;
    await L.sleep(20);
  }
  log.taken = at();
  log.opAtTake = await opFull(before.op).then((o) => `${o?.state}/${o?.delivery}/${o?.err}`);
  log.bindingAtTake = await bindingFull(before.T).then((b) => b.map((x) => `${x.state}/drainRcpt=${x.drainRcpt}`));
  log.rtAtTake = await rtSessions(before.bindingT.id).then((r) => r.map((x) => `${x.kind}:${x.state}`));
  await L.sleep(MAINT);
  const r2 = await L.sql("UPDATE managed_workspace_execution_lease SET holder_key=NULL, maintenance_id=NULL WHERE storage_key=? AND storage_kind='LOCAL' AND holder_key=? AND maintenance_id=?", [before.storageKey, holder, id]);
  log.released = at();
  log.releasedRows = r2.affectedRows;
  log.opAtRelease = await opFull(before.op).then((o) => `${o?.state}/${o?.delivery}/${o?.err} x${o?.attempts}`);
  return log;
}

// Round 4: the target binding's drain claim and Session rows as the Broker leaves them, every 25 ms after the fault.
// leftMs = operation_lease_until - UTC_TIMESTAMP(6) (the Broker writes UTC wall clock); a lapse is owner set and leftMs < 0.
async function sampler(before, faultAt, stop) {
  const at = () => +((Date.now() - faultAt) / 1000).toFixed(2);
  const log = { samples: 0, transitions: [], states: [], lapses: [], minLeftMs: null, maxLeaseStallMs: 0 };
  let last = '', lapse = null, lastLease = null, leaseSince = null;
  while (!stop.done) {
    const b = (await L.sql("SELECT binding_state AS s, drain_requested AS d, operation_owner IS NOT NULL AS o, operation_generation AS g, IF(drain_receipt_json IS NULL,0,1) AS r, DATE_FORMAT(operation_lease_until, '%H:%i:%s.%f') AS lu, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), operation_lease_until) AS leftUs FROM qwen_runtime_binding WHERE binding_id=?", [before.bindingT.id]))[0];
    const rt = (await rtSessions(before.bindingT.id)).map((x) => `${x.kind}:${x.state}`).join(',');
    log.samples++;
    const key = `${b?.s}/drain=${b?.d}/rcpt=${b?.r}/owner=${b?.o}/opGen=${b?.g} rt=${rt}`;
    if (key !== last) { log.transitions.push(`+${at()}s ${key}`); last = key; }
    if (b?.s && !log.states.includes(b.s)) log.states.push(b.s);
    const left = b?.leftUs == null ? null : Math.round(Number(b.leftUs) / 1000);
    // Only a claim that is still working counts: a RELEASED binding keeps its last owner and lease_until.
    if (Number(b?.o) === 1 && left != null && b.s !== 'RELEASED') {
      log.minLeftMs = log.minLeftMs == null ? left : Math.min(log.minLeftMs, left);
      if (b.lu !== lastLease) { if (leaseSince != null) log.maxLeaseStallMs = Math.max(log.maxLeaseStallMs, Date.now() - leaseSince); lastLease = b.lu; leaseSince = Date.now(); }
      if (left < 0 && !lapse) lapse = { from: at(), opGen: b.g, leaseUntil: b.lu };
      if (left >= 0 && lapse) { log.lapses.push({ ...lapse, to: at() }); lapse = null; }
    } else if (lapse) { log.lapses.push({ ...lapse, to: at(), note: 'claim released' }); lapse = null; }
    await L.sleep(25);
  }
  if (lapse) log.lapses.push({ ...lapse, to: null });
  if (leaseSince != null) log.maxLeaseStallMs = Math.max(log.maxLeaseStallMs, Date.now() - leaseSince);
  return log;
}

// Round 4 (R2-1): once the target's drain claim is DRAINING, hold the tenant placement guard (LOCK=guard) or the
// target storage's holder row (LOCK=holder) FOR UPDATE on a separate connection for LOCK_MS (< innodb_lock_wait_timeout 50 s).
async function lockInjector(before, faultAt, stop) {
  const at = () => +((Date.now() - faultAt) / 1000).toFixed(2);
  const conn = await mysql.createConnection({ host: process.env.DBHOST ?? 'pr13673-db', user: 'root', password: fs.readFileSync(`${L.RIG}/lx/.dbpass`, 'utf8').trim(), database: L.DB, dateStrings: true, timezone: 'Z' });
  const tenantKey = await L.one("SELECT tenant_key FROM qwen_runtime_placement_guard WHERE tenant_id=?", [L.TENANT]);
  const stmt = LOCK === 'guard'
    ? ['SELECT tenant_id FROM qwen_runtime_placement_guard WHERE tenant_key=? FOR UPDATE', [tenantKey]]
    : ["SELECT holder_key FROM managed_workspace_execution_lease WHERE storage_key=? AND storage_kind='LOCAL' FOR UPDATE", [before.storageKey]];
  const log = { lock: LOCK, row: LOCK === 'guard' ? 'qwen_runtime_placement_guard (tenant t-rig)' : 'managed_workspace_execution_lease (target storage)', holdMs: LOCK_MS, polls: 0 };
  const snap = async () => {
    const b = (await L.sql("SELECT binding_state AS s, drain_requested AS d, IF(drain_receipt_json IS NULL,0,1) AS r, operation_generation AS g, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), operation_lease_until) DIV 1000 AS leftMs FROM qwen_runtime_binding WHERE binding_id=?", [before.bindingT.id]))[0];
    return `${b?.s}/drain=${b?.d}/rcpt=${b?.r}/opGen=${b?.g}/leaseLeftMs=${b?.leftMs} rt=${(await rtSessions(before.bindingT.id)).map((x) => x.state).join(',')}`;
  };
  try {
    for (;;) {
      if (stop.done) { log.taken = null; log.note = 'the drain claim never reached DRAINING while observed'; return log; }
      const b = (await L.sql('SELECT binding_state AS s, drain_requested AS d FROM qwen_runtime_binding WHERE binding_id=?', [before.bindingT.id]))[0];
      log.polls++;
      if (b?.s === 'DRAINING' && Number(b.d) === 1) break;
      await L.sleep(5);
    }
    log.triggeredAt = at();
    await conn.query('START TRANSACTION');
    await conn.query(stmt[0], stmt[1]);
    log.taken = at();
    log.atTake = await snap();
    const end = Date.now() + LOCK_MS;
    log.waiters = [];
    while (Date.now() < end) {
      const w = await L.sql("SELECT trx_id AS id, DATE_FORMAT(trx_wait_started, '%H:%i:%s') AS since, LEFT(REPLACE(trx_query, '\n', ' '), 110) AS q FROM information_schema.innodb_trx WHERE trx_state='LOCK WAIT'");
      for (const x of w) if (!log.waiters.some((y) => y.id === x.id)) log.waiters.push({ ...x, seenAt: at() });
      await L.sleep(250);
    }
    log.beforeRelease = await snap();
    await conn.query('COMMIT');
    log.released = at();
    await L.sleep(1500);
    log.afterRelease = await snap();
    return log;
  } finally { await conn.end().catch(() => {}); }
}

// Round 4 (R2-2): LockGrab.class takes the target's LocalRuntimeStore lock right after the first reconcile.
function startFlock(before) {
  const rid = JSON.parse(before.bindingT.handle).resourceId;
  const out = `${L.OUT}/lockgrab.jsonl`;
  fs.writeFileSync(out, '');
  const fd = fs.openSync(out, 'a');
  const child = spawn('/opt/java/openjdk/bin/java', ['-cp', `${L.RIG}/probe`, 'LockGrab', `${L.VARRUN}/broker/${rid}.lock`, `${L.VARRUN}/broker/${rid}.json`, String(FLOCK), String(DEADLINE)], { stdio: ['ignore', fd, fd], detached: true });
  child.unref();
  return { pid: child.pid, out };
}

// Round 4: Harness -> Broker answers for the target after the fault (tap 16675 records status + error body).
function brokerAnswers(T, sinceIso) {
  const f = `${L.LOGD}/broker-tap.jsonl`;
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.t >= sinceIso && (e.body?.harnessSessionId === T || e.path.includes(T)))
    .map((e) => `${e.t.slice(11, 23)} ${e.path.replace(/^.*\/v1\//, '').replace(/hooks-activation-[0-9a-f]{12}[0-9a-f]+/, 'hooks-…')} -> ${e.status ?? e.error}${e.upstreamBody?.code ? ' ' + e.upstreamBody.code : ''}`);
}

async function watch(op, faultAt, deadline) {
  const timeline = [];
  let last = '';
  const t0 = Date.now();
  let o;
  for (;;) {
    o = await opFull(op);
    const key = `${o?.state}/${o?.delivery}/${o?.err}/g${o?.gen}`;
    if (key !== last) { timeline.push(`+${((Date.now() - faultAt) / 1000).toFixed(1)}s ${key}`); last = key; }
    if (['COMPLETED', 'FAILED'].includes(o?.state)) break;
    if (Date.now() - t0 > deadline) break;
    await L.sleep(500);
  }
  return { o, timeline };
}

async function observe(before, faultAt, pre = [], deadline = DEADLINE) {
  const { T, N, op } = before;
  await L.api('GET', `/v1/agents/sessions/${T}`); // warm-up: drop a pooled socket of the stopped Spring
  const w = await watch(op, faultAt, deadline);
  const o = w.o;
  const timeline = [...pre, ...w.timeline];
  const doneMs = Date.now() - faultAt;
  R.note('operation timeline after the fault (state/delivery/error/claim)', timeline);
  const sr = await L.sessRow(T);
  const hk = recs(T);
  const bs = await bindingFull(T);
  const b = bs.at(-1);
  const rt = await rtSessions(before.bindingT.id);
  const ret = await L.retirement(T);
  const holders = await holderRows();
  const wT = await L.workerOf(T);
  const ok = R.check(`[${FAULT}] original operation COMPLETED and target DELETED within ${DEADLINE / 1000}s of the fault`, o?.state === 'COMPLETED' && sr?.status === 'DELETED', { op: { state: o?.state, err: o?.err, gen: o?.gen, attempts: o?.attempts }, session: sr?.status, ms: doneMs });
  R.check(`[${FAULT}] End and Delete command Hooks each executed exactly once (no replay)`, hk.filter((e) => e.event === 'SessionEnd').length === 1 && hk.filter((e) => e.event === 'SessionDelete').length === 1 && hk.length === 2, hk.map((e) => `${e.event}:${e.phase}@${e.t.slice(11, 23)}`));
  R.check(`[${FAULT}] effect receipt bytes unchanged`, o?.effects === before.effectsBytes, { same: o?.effects === before.effectsBytes });
  R.check(`[${FAULT}] exactly one retirement row`, ret.length === 1, ret);
  R.check(`[${FAULT}] original binding/generation/handle/seed/lease kept, no replacement generation`, bs.length === 1 && b.id === before.bindingT.id && b.gen === before.bindingT.gen && b.handle === before.bindingT.handle && b.seed === before.bindingT.seed && b.lease === before.bindingT.lease, { bindings: bs.map((x) => ({ id: x.id.slice(0, 12), gen: x.gen, state: x.state, drainReq: x.drainReq, drainRcpt: x.drainRcpt, opGen: x.opGen })) });
  R.check(`[${FAULT}] binding drained with a persisted stop receipt for the original resource`, ['DRAINING', 'RELEASED'].includes(b.state) && b.drainRcpt === 1 && (b.receipt ?? '').includes(JSON.parse(before.bindingT.handle).resourceId), { state: b.state, drainRcpt: b.drainRcpt, receipt: b.receipt ? JSON.parse(b.receipt) : null });
  R.check(`[${FAULT}] all original RuntimeSessions RELEASED`, rt.length > 0 && rt.every((x) => x.state === 'RELEASED'), rt.map((x) => `${x.id.slice(0, 28)}:${x.kind}:${x.state}`));
  R.check(`[${FAULT}] storage holder cleared (no LOCAL holder row still held)`, holders.length > 0 && holders.every((h) => Number(h.held) === 0), holders);
  R.check(`[${FAULT}] original target worker process gone (pid ${before.workerT.pid})`, !before.workerT.pid || !L.alive(before.workerT.pid) || before.boot !== bootId(), { before: before.workerT, after: wT });
  R.check(`[${FAULT}] no replacement worker for the target`, L.pidsOfSession(T).length === 0, L.pidsOfSession(T));
  R.check(`[${FAULT}] no model replay after the fault`, modelCount() === before.modelsAtFault, { atFault: before.modelsAtFault, now: modelCount() });
  const files = fs.readdirSync(`${L.VARRUN}/ws/a/child`).sort();
  const bytes = Object.fromEntries(files.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(`${L.VARRUN}/ws/a/child/${f}`)).digest('hex').slice(0, 16)]));
  R.check(`[${FAULT}] shared workspace files byte-identical (target + neighbor files kept)`, JSON.stringify(bytes) === JSON.stringify(before.files), { before: before.files, after: bytes });
  const nr = await L.sessRow(N);
  R.check(`[${FAULT}] neighbor Session not retired`, nr?.status !== 'DELETED' && (await L.retirement(N)).length === 0, { status: nr?.status });
  R.note('journal head (target)', await L.journalHead(T));
  R.note('harness drain fence (target)', await L.drains(T));
  // Live-path neighbour follow-up: only meaningful when its worker was not part of the fault.
  if (ok) {
    const before2 = (await L.turns(N)).length;
    const s = await L.sendInput(N, `G_WRITE name=neighbor-after-${Date.now().toString(36)}.txt content=after`);
    const t = await L.waitTurns(N, before2 + 1, 90_000);
    const st = fs.existsSync(`${L.LOGD}/store-tap.jsonl`) ? fs.readFileSync(`${L.LOGD}/store-tap.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    const stale = st.filter((e) => e.path.includes(N) && e.path.endsWith('writers:renew') && e.upstreamBody?.error?.code === 'managed_session_writer_conflict').length;
    R.note(`neighbor follow-up Turn after the retirement (${['spring-workers', 'all', 'reboot'].includes(FAULT) ? 'its worker was part of the fault' : 'its worker untouched'})`, { send: s.status, turn: t.rows.at(-1)?.status, ms: t.ms, timeout: !!t.timeout, neighborWriterStaleRenewals: stale, cause: t.rows.at(-1)?.status === 'COMPLETED' ? 'ok' : stale ? 'pre-existing: neighbor writer lease lapsed during the Spring outage (reproduced on base without Hooks)' : 'unclassified' });
  }
  return { doneMs, timeline };
}

if (PHASE === 'resume') {
  const before = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const faultAt = before.faultAt;
  R.check('[reboot] boot identity changed (actual OS reboot) and machine-id unchanged', before.boot !== bootId() && fs.readFileSync('/etc/machine-id', 'utf8').trim() === before.machineId, { before: before.boot, after: bootId() });
  R.say(`restart: ${(await restart()).join(' | ')}`);
  const res = await observe(before, Date.now());
  R.note('elapsed since the reboot was ordered', `${((Date.now() - faultAt) / 1000).toFixed(1)} s`);
  R.done(res);
} else {
  const before = await setup();
  before.modelsAtFault = modelCount();
  before.machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
  if (PHASE === 'prep') {
    before.faultAt = Date.now();
    fs.writeFileSync(STATE, JSON.stringify(before, null, 1));
    R.say('prep done: reboot the VM now');
    R.done();
  } else {
    const faultAt = Date.now();
    const sinceIso = new Date(faultAt).toISOString();
    const fl = FLOCK ? startFlock(before) : null;
    R.say(`fault: ${inject(before).join(' | ')}`);
    const stop = { done: false };
    let pre = [];
    let deadline = DEADLINE;
    let sm, lk;
    if (GATE) {
      // Spring and Harness stay up: open the gate so the held detach reaches the Broker that still holds the context.
      await L.sleep(500);
      fs.writeFileSync(`${L.TAP_RULES}.open`, '');
      L.setTapRules([]);
      R.say('gate opened: the post-effect detach proceeds to the live Spring/Harness/Broker');
      sm = sampler(before, faultAt, stop);
      if (RESTART_AFTER) {
        const w1 = await watch(before.op, faultAt, RESTART_AFTER);
        pre = w1.timeline;
        if (!['COMPLETED', 'FAILED'].includes(w1.o?.state)) {
          R.note(`phase 1: Spring/Harness never restarted, ${RESTART_AFTER / 1000}s after the worker kill`, { op: `${w1.o?.state}/${w1.o?.delivery}/${w1.o?.err}`, broker: brokerAnswers(before.T, sinceIso).slice(-6) });
          pre.push(`+${((Date.now() - faultAt) / 1000).toFixed(1)}s --- Spring TERM restart ---`);
          R.say(`restart: ${L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring TERM`, { allowFail: true }).split('\n')[0]} | ${(await restart()).join(' | ')}`);
          deadline = Math.max(60_000, DEADLINE - RESTART_AFTER);
        }
      }
    } else {
      await L.closeDb();
      R.say(`restart: ${(await restart()).join(' | ')}`);
      sm = sampler(before, faultAt, stop);
    }
    lk = LOCK ? lockInjector(before, faultAt, stop) : null;
    const mt = MAINT ? maintenance(before, faultAt, stop) : null;
    const res = await observe(before, faultAt, pre, deadline);
    stop.done = true;
    const s = await sm;
    R.note('target binding drain claim and RuntimeSessions after the fault (25 ms sampler)', s);
    R.note('binding states seen after the fault', s.states);
    R.note('Harness -> Broker answers for the target after the fault', brokerAnswers(before.T, sinceIso));
    if (lk) {
      const k = await lk;
      R.note(`injected ${LOCK} lock`, k);
      R.check(`[${FAULT}+lock-${LOCK}] the lock was taken while the drain was running and the Broker waited on it`, k.taken != null && (k.waiters ?? []).length > 0, { taken: k.taken, waiters: k.waiters?.length, atTake: k.atTake });
    }
    if (fl) {
      await L.sleep(200);
      const lines = fs.readFileSync(fl.out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((e) => ({ ...e, at: +((e.epochMs - faultAt) / 1000).toFixed(2), retiredAt: e.retiredSeenEpochMs ? +((e.retiredSeenEpochMs - faultAt) / 1000).toFixed(2) : undefined }));
      if (L.alive(fl.pid)) { try { process.kill(fl.pid, 'SIGKILL'); } catch {} }
      R.note('LocalRuntimeStore lock grab (LockGrab)', lines);
      R.check(`[${FAULT}+flock] the lock was grabbed after the first reconcile retired the registration and later released`, lines.some((e) => e.event === 'grabbed') && lines.some((e) => e.event === 'released'), lines.map((e) => `${e.event}@${e.at}`));
    }
    if (mt) {
      const m = await mt;
      R.note('emulated child-Workspace maintenance hold on the target storage', m);
      R.check(`[${FAULT}+maint] the hold landed while the retirement was still running`, m.taken != null && !String(m.opAtTake).startsWith('COMPLETED'), m);
      R.check(`[${FAULT}+maint] retirement completed only after the hold was released`, m.released != null && res.doneMs / 1000 >= m.released, { doneS: +(res.doneMs / 1000).toFixed(1), releasedS: m.released });
    }
    R.done(res);
  }
}
await L.closeDb();
