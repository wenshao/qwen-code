// VERIFICATION RIG ONLY (PR #13673): idle files/1 Session with original COMMAND Hooks; DELETE; the tap holds the
// post-effect POST /session/<T>/detach (End and Delete effects are already durable); inject FAULT; restart; observe <=180 s.
// usage: DB=.. ARM=<jar arm> DIST=<dist arm> FAULT=<spring-term|spring-kill|spring-workers|all|reboot> PHASE=<run|prep|resume> node p-recover.mjs
import * as L from './lib.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const FAULT = process.env.FAULT ?? 'spring-term';
const PHASE = process.env.PHASE ?? 'run';
const DIST = process.env.DIST ?? L.ARM;
const DEADLINE = Number(process.env.DEADLINE_MS ?? 180_000);
const R = new L.Report(`recover-${FAULT}${PHASE === 'resume' ? '-resume' : PHASE === 'prep' ? '-prep' : ''}`);
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
  const before = {
    T, N, boot: bootId(), files: bytes, decoy,
    bindingT: { id: bT.id, gen: bT.gen, state: bT.state, handle: bT.handle, seed: bT.seed, lease: bT.lease },
    bindingN: { id: bN.id, gen: bN.gen, state: bN.state },
    rtT: await rtSessions(bT.id), holders: await holderRows(),
    workerT: await L.workerOf(T), workerN: await L.workerOf(N), models: modelCount(),
  };
  R.note('before: target runtime sessions (original Hook + tool sessions on one binding)', before.rtT);
  R.note('before: storage holders', before.holders);
  R.note('before: workers', { T: before.workerT, N: before.workerN });
  // Hold the post-effect detach of the target only.
  L.setTapRules([{ match: `^POST /session/${T}/detach$`, action: 'hold', times: 1 }]);
  const t0 = L.tapLen();
  const d = await L.del('public', T);
  const op = L.opIdOf('public', d);
  R.note('DELETE accepted', { status: d.status, op });
  const held = await L.waitFor(async () => L.tap().slice(t0).some((e) => e.fault === 'hold' && e.path.includes(T)), 120_000, 200);
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

async function observe(before, faultAt) {
  const { T, N, op } = before;
  await L.api('GET', `/v1/agents/sessions/${T}`); // warm-up: drop a pooled socket of the stopped Spring
  const timeline = [];
  let last = '';
  const t0 = Date.now();
  let o;
  for (;;) {
    o = await opFull(op);
    const key = `${o?.state}/${o?.delivery}/${o?.err}/g${o?.gen}`;
    if (key !== last) { timeline.push(`+${((Date.now() - faultAt) / 1000).toFixed(1)}s ${key}`); last = key; }
    if (['COMPLETED', 'FAILED'].includes(o?.state)) break;
    if (Date.now() - t0 > DEADLINE) break;
    await L.sleep(500);
  }
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
    R.say(`fault: ${inject(before).join(' | ')}`);
    await L.closeDb();
    R.say(`restart: ${(await restart()).join(' | ')}`);
    const res = await observe(before, faultAt);
    R.done(res);
  }
}
await L.closeDb();
