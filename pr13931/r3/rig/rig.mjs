// PR #13931 real-stack scenarios (Linux durable local-process, public Shell profile).
// Usage: node rig.mjs <l4|v1off> <arm> <db>
//   l4     Harness advertises lifecycle v2 for hosted-workspace-shell/1 (QWEN_HOSTED_LIFECYCLE_V2_PROFILES)
//   v1off  same stack without the v2 advertisement (default-off control)
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  T, sleep, makeCtx, sqlFor, q, rows, startFakeModel, modelRequests, stop,
  allocPorts, startSpring, startHarness, apiFor,
} from './lib.mjs';
import { startTap } from './tap.mjs';
import { startMcpHttp } from './mcp-http.mjs';
import { createHash } from 'node:crypto';

const [phase, arm, db] = process.argv.slice(2);
const cliArm = process.env.RIG_CLI_ARM ?? arm;
const ctx = makeCtx({ phase, arm, db, cliArm });
ctx.STORAGES = ['st1', 'st2', 'st3', 'st4', 'st5', 'st6', 'st7', 'st8', 'st9'];
for (const st of ctx.STORAGES) for (const c of ['child', 'c2']) fs.mkdirSync(`${ctx.mount(st)}/${c}`, { recursive: true });
const sql = sqlFor(ctx);
const api = apiFor(ctx);
const { log, check, record } = ctx;
const W = { W1: 'st1', W2: 'st2', W3: 'st3', W4: 'st4', W5: 'st5', W6: 'st6', W7: 'st7', W8: 'st8', W9: 'st9' };
const OP_WAIT_MS = Number(process.env.RIG_OP_WAIT_MS ?? 120000);

// ---------- helpers ----------
const turnsOf = (sid) => rows(sql(`SELECT turn_id, status, COALESCE(error_code,'') FROM managed_agent_turn WHERE session_id=${q(sid)} ORDER BY created_at, turn_id`));
const opRows = (sid) => rows(sql(`SELECT operation_id, operation_kind, state, COALESCE(error_code,''), COALESCE(lifecycle_protocol_version,-1) FROM managed_agent_operation WHERE session_id=${q(sid)} AND operation_kind IN ('CLOSE','ARCHIVE','UNARCHIVE','DELETE') ORDER BY created_at`));
const sessStatus = (sid) => sql(`SELECT status FROM managed_agent_session WHERE session_id=${q(sid)}`) || '(gone)';
const profileOf = (sid) => sql(`SELECT COALESCE(tool_profile,'(null)') FROM managed_agent_session WHERE session_id=${q(sid)}`);
const retirementCount = (sid) => Number(sql(`SELECT COUNT(*) FROM qwen_output_session_retirement WHERE tenant_id=${q(T)} AND session_id=${q(sid)}`));
async function waitTurn(sid, poll, timeoutMs = 150000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    if (poll) await poll();
    last = turnsOf(sid).at(-1) ?? null;
    if (last && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(last[1])) return { turn: last[0], status: last[1], error: last[2] || null };
    await sleep(300);
  }
  return { turn: last?.[0] ?? null, status: `TIMEOUT(last=${last?.[1] ?? 'none'})`, error: last?.[2] || null };
}
async function listActions(sid, web = false) {
  return web ? api('op', 'POST', '/api/agent/web-shell/v1/actions/query', { sessionId: sid }) : api('op', 'GET', `/v1/agents/sessions/${sid}/actions`);
}
async function openAction(sid, web) {
  const r = await listActions(sid, web);
  return (r.json?.data ?? []).find((a) => (a.status ?? a.state) === 'requested' || !(a.status ?? a.state)) ?? null;
}
async function respond(sid, action, option, web = false) {
  const id = action.id ?? action.actionId;
  if (web) {
    return api('op', 'POST', '/api/agent/web-shell/v1/actions/respond', { sessionId: sid, actionId: id, idempotencyKey: `${id}:${option}`, requestId: 'rig', response: { kind: 'permission', optionId: option, inputRevision: action.inputRevision, policyRevision: action.policyRevision } });
  }
  return api('op', 'POST', `/v1/agents/sessions/${sid}/actions/${id}/responses`, { kind: 'permission', option_id: option, input_revision: action.input_revision, policy_revision: action.policy_revision }, { 'idempotency-key': `${id}:${option}` });
}
const drive = (sid, option = 'allow', web = false) => waitTurn(sid, async () => {
  const a = await openAction(sid, web);
  if (a) { const r = await respond(sid, a, option, web); log('respond', sid.slice(0, 8), option, r.status, r.code); }
});
const restCreate = (ws, input, key = randomUUID()) =>
  api('op', 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: ws, cwd_relative: 'child' }, ...(input ? { input: [{ type: 'input_text', text: input }] } : {}), metadata: { title: `rig ${input ?? 'idle'}` } }, { 'idempotency-key': key });
const webCreate = (ws, key = randomUUID()) =>
  api('op', 'POST', '/api/agent/web-shell/v1/sessions/create', { idempotencyKey: key, agentId: 'qwen-code', title: 'rig web', input: [], workspace: { workspaceId: ws, cwdRelative: 'child' } });
const webSubmit = (sid, text, key = randomUUID()) =>
  api('op', 'POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: sid, idempotencyKey: key, input: [{ type: 'input_text', text }] });
async function lifecycle(sid, kind, web, key) {
  if (web) return api('op', 'POST', `/api/agent/web-shell/v1/sessions/${kind}`, { sessionId: sid, idempotencyKey: key });
  if (kind === 'delete') return api('op', 'DELETE', `/v1/agents/sessions/${sid}`, null, { 'idempotency-key': key });
  return api('op', 'POST', `/v1/agents/sessions/${sid}/${kind}`, null, { 'idempotency-key': key });
}
async function waitOperation(sid, opId, timeoutMs = OP_WAIT_MS) {
  const t0 = Date.now(); const end = t0 + timeoutMs; let last; const seen = [];
  while (Date.now() < end) {
    last = await api('op', 'GET', `/v1/agents/sessions/${sid}/operations/${opId}`);
    const st = last.json?.status;
    if (seen.at(-1)?.status !== st) seen.push({ status: st, atMs: Date.now() - t0 });
    if (['completed', 'failed'].includes(st)) break;
    await sleep(500);
  }
  return { final: last?.json ?? null, transitions: seen, waitedMs: Date.now() - t0 };
}
const proof = (ws, id) => { const p = `${ctx.mount(W[ws])}/child/shell-proof-${id}.txt`; return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const resources = (sid) => rows(sql(`SELECT resource_id, kind, state, storage_kind, byte_length, CASE WHEN inline_bytes IS NULL THEN 0 ELSE 1 END FROM qwen_managed_session_resource WHERE tenant_id=${q(T)} AND session_id=${q(sid)} ORDER BY kind, resource_id`))
  .map(([id, kind, state, storage, len, inl]) => ({ id: id.slice(0, 12), kind, state, storage, len: Number(len), inline: inl === '1' }));

// Recompute the verifier's first identity guard (WorkspaceProfileLifecycleVerifier.verifyManifest) from the
// stored rows, field by field, so a blocked operation names the exact mismatch.
function identityDiff(sid) {
  const out = [];
  const execs = rows(sql(`SELECT e.execution_call_id, e.turn_id, e.runtime_generation, e.reference_json, e.execution_state FROM qwen_tool_execution e WHERE e.harness_session_id=${q(sid)}`));
  const sources = rows(sql(`SELECT source_json FROM managed_agent_tool_result WHERE tenant_id=${q(T)} AND session_id=${q(sid)}`)).map((r) => JSON.parse(r[0]));
  const readRes = (rid) => {
    const hex = sql(`SELECT HEX(inline_bytes) FROM qwen_managed_session_resource WHERE tenant_id=${q(T)} AND session_id=${q(sid)} AND resource_id=${q(rid)}`);
    return hex ? Buffer.from(hex, 'hex').toString('utf8') : null;
  };
  for (const [call, turnId, gen, refJson, execState] of execs) {
    const ref = JSON.parse(refJson);
    const src = sources.find((s) => s.executionCallId === call);
    const item = { executionCallId: call, execState, dispatchMode: ref.dispatchMode ?? null, runtimeProtocol: ref.runtimeProtocol ?? null, publicationId: ref.publicationId ?? null, hasSource: !!src };
    // Round 2 (2ef8fba0d2): the verifier takes inputDigest only for runtimeProtocol 3 + dispatchMode deferred.
    const v2Expected = ref.runtimeProtocol === 3 && ref.dispatchMode === 'deferred' ? ref.inputDigest : ref.argsDigest;
    if (src?.outcomeRef?.resourceId) {
      const outcome = JSON.parse(readRes(src.outcomeRef.resourceId) ?? 'null');
      const mref = outcome?.envelope?.capture?.manifest;
      item.outcome = { version: outcome?.version, decision: outcome?.decision, captureStatus: outcome?.envelope?.capture?.captureStatus, executionStatus: outcome?.envelope?.executionStatus };
      if (mref?.resourceId) {
        const raw = readRes(mref.resourceId);
        let m = null; try { m = JSON.parse(raw); } catch {}
        if (m) {
          const pairs = {
            captureScope: [m.captureScope, 'process_pipes'],
            capturePolicy: [m.capturePolicy, 'complete_required'],
            callId: [m.callId, ref.callId],
            'invocationDigest~reference.argsDigest': [m.invocationDigest, ref.argsDigest],
            'invocationDigest~reference.inputDigest': [m.invocationDigest, ref.inputDigest ?? null],
            'invocationDigest~2ef8fba0 selection': [m.invocationDigest, v2Expected ?? null],
            tenantId: [m.tenantId, T],
            sessionId: [m.sessionId, sid],
            turnId: [m.turnId, turnId],
            executionCallId: [m.executionCallId, call],
            'bindingGeneration~execution.runtime_generation': [String(m.bindingGeneration), String(gen)],
            executionStatus: [m.executionStatus, '(not unknown)'],
            captureStatus: [m.captureStatus, '(not pending)'],
          };
          item.identity = Object.fromEntries(Object.entries(pairs).map(([k, [have, want]]) => {
            const ok = want?.startsWith?.('(not ') ? have !== want.slice(5, -1) : have === want;
            return [k, { manifest: have, expected: want, ok }];
          }));
          item.manifestContents = (m.contents ?? []).map((c) => ({ streamId: c.streamId, state: c.state, byteLength: c.byteLength, body: c.body?.ref ? 'ref' : `pages:${c.body?.pages?.length ?? 0}` }));
        } else item.manifestParse = 'failed';
      }
    }
    out.push(item);
  }
  return out;
}

function seedRegistry() {
  const reg = (w, st) => `INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(T)}, '${w}', 1, '${st}', 'Rig ${w}', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`;
  const grant = (w, a, role) => `INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, '${w}', '${a}', '${role}')`;
  sql([...Object.entries(W).map(([w, st]) => reg(w, st)), ...Object.keys(W).map((w) => grant(w, 'op', 'OPERATOR'))].join(';'));
}

let fake, spring, harness, tap;
const springOver = () => ({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'true',
  ...(tap ? { QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${tap.port}` } : {}), ...(ctx.springExtra ?? {}) });
async function up({ withTap = false } = {}) {
  await allocPorts(ctx);
  fake = await startFakeModel(ctx);
  if (withTap) tap = await startTap(ctx, ctx.harnessPort);
  spring = await startSpring(ctx, springOver());
  seedRegistry();
  harness = await startHarness(ctx, fake);
}
async function down() {
  await stop(harness);
  await stop(spring);
  try { fake?.server.close(); } catch {}
  try { tap?.server.close(); } catch {}
}

// One foreground-Shell Session through one surface, then one lifecycle operation.
async function scenario(tag, { ws, id, kind = 'delete', web = false, option = 'allow', input = 'FG', companion = false }) {
  const S = {};
  let sid;
  if (web) {
    const c = await webCreate(ws);
    sid = c.json?.sessionId;
    S.create = `${c.status} ${c.code ?? ''}`.trim();
    if (input) S.submit = (await webSubmit(sid, `${input}::${id}`)).status;
  } else {
    const c = await restCreate(ws, input ? `${input}::${id}` : null);
    sid = c.json?.id;
    S.create = `${c.status} ${c.code ?? ''}`.trim();
  }
  S.sid = sid;
  S.profile = profileOf(sid);
  if (input) {
    S.turn = await drive(sid, option, web);
    S.proof = proof(ws, id);
  } else {
    for (let i = 0; i < 60 && sessStatus(sid) !== 'ACTIVE'; i++) await sleep(500);
  }
  S.resourcesBefore = resources(sid);
  if (input) { try { S.identityBefore = identityDiff(sid); } catch (e) { S.identityBefore = `error: ${e.message}`; } }
  if (companion) {
    const c = await restCreate(ws, null);
    S.companion = c.json?.id;
    for (let i = 0; i < 60 && sessStatus(S.companion) !== 'ACTIVE'; i++) await sleep(500);
    fs.writeFileSync(`${ctx.mount(W[ws])}/child/shared-marker-${id}.txt`, 'shared\n');
  }
  const r = await lifecycle(sid, kind, web, `${tag}-${kind}`);
  S.admit = `${r.status} ${r.code ?? ''}`.trim();
  const opId = web ? r.json?.operationId : r.json?.id;
  if (r.status === 202 && opId) {
    S.op = await waitOperation(sid, opId);
    S.opRow = opRows(sid).map(([oid, k, st, err, ver]) => ({ kind: k, status: st, error: err || null, lifecycleVersion: Number(ver) }));
  } else {
    S.opRowCount = opRows(sid).length;
  }
  S.sessionAfter = sessStatus(sid);
  S.retirements = retirementCount(sid);
  S.resourcesAfter = resources(sid);
  if (S.op && S.op.final?.status !== 'completed') S.identityDiff = identityDiff(sid);
  if (companion) {
    S.companionAfter = sessStatus(S.companion);
    S.companionRetirements = retirementCount(S.companion);
    S.sharedMarker = fs.existsSync(`${ctx.mount(W[ws])}/child/shared-marker-${id}.txt`);
  }
  S.proofAfter = proof(ws, id);
  record(tag, S);
  log(tag, JSON.stringify({ admit: S.admit, turn: S.turn?.status, op: S.op?.final?.status, err: S.op?.final?.error ?? null, session: S.sessionAfter }));
  return S;
}

async function phaseL4() {
  ctx.v2Profiles = 'hosted-workspace-shell/1';
  await up();
  const A = await scenario('A_rest_fg_delete', { ws: 'W1', id: 'a', companion: true });
  check('A turn completed after approval', A.turn?.status, 'COMPLETED');
  check('A proof written once', A.proof, 'once\n');
  check('A delete admitted', A.admit, '202');
  check('A delete operation completed', A.op?.final?.status, 'completed');
  check('A companion Session still ACTIVE', A.companionAfter, 'ACTIVE');
  check('A shared Workspace marker survives', A.sharedMarker, true);
  const B = await scenario('B_rest_idle_delete', { ws: 'W2', id: 'b', input: null });
  check('B idle (no Shell call) delete completed', B.op?.final?.status, 'completed');
  const C = await scenario('C_rest_fg_close', { ws: 'W3', id: 'c', kind: 'close' });
  check('C close operation completed', C.op?.final?.status, 'completed');
  const D = await scenario('D_web_fg_delete', { ws: 'W4', id: 'd', web: true });
  check('D WebShell turn completed', D.turn?.status, 'COMPLETED');
  check('D WebShell delete operation completed', D.op?.final?.status, 'completed');
  const E = await scenario('E_rest_deny_delete', { ws: 'W5', id: 'e', option: 'deny' });
  check('E denied Shell wrote no proof', E.proof, null);
  check('E delete after denied Shell completed', E.op?.final?.status, 'completed');
  record('modelRequests', modelRequests(fake).length);
  await down();
}

// Round 2 extras on the fixed head: more capture shapes through the same verifier.
async function phaseL4x() {
  ctx.v2Profiles = 'hosted-workspace-shell/1';
  await up();
  const allMatch = (S) => Array.isArray(S.identityBefore) && S.identityBefore.length > 0
    && S.identityBefore.every((it) => it.identity && it.identity['invocationDigest~2ef8fba0 selection']?.ok
      && Object.entries(it.identity).filter(([k]) => !k.startsWith('invocationDigest~reference.')).every(([, v]) => v.ok));
  const G = await scenario('G_rest_fg2_delete', { ws: 'W7', id: 'g', input: 'FG2' });
  check('G two approved Shell calls in one turn completed', G.turn?.status, 'COMPLETED');
  check('G both Shell calls ran once', G.proof, 'one\ntwo\n');
  check('G two executions captured', Array.isArray(G.identityBefore) ? G.identityBefore.filter((i) => i.identity).length : G.identityBefore, 2);
  check('G every identity field matches (2ef8fba0 selection)', allMatch(G), true);
  check('G delete operation completed', G.op?.final?.status, 'completed');
  check('G Session DELETED', G.sessionAfter, 'DELETED');
  const H = await scenario('H_rest_fgx_delete', { ws: 'W8', id: 'h', input: 'FGX' });
  check('H non-zero-exit Shell turn completed', H.turn?.status, 'COMPLETED');
  check('H every identity field matches (2ef8fba0 selection)', allMatch(H), true);
  check('H delete operation completed', H.op?.final?.status, 'completed');
  check('H Session DELETED', H.sessionAfter, 'DELETED');
  const K = await scenario('K_rest_fgbig_delete', { ws: 'W9', id: 'k', input: 'FGBIG' });
  check('K 1 MiB stdout Shell turn completed', K.turn?.status, 'COMPLETED');
  check('K every identity field matches (2ef8fba0 selection)', allMatch(K), true);
  check('K delete operation completed', K.op?.final?.status, 'completed');
  check('K Session DELETED', K.sessionAfter, 'DELETED');
  record('modelRequests', modelRequests(fake).length);
  await down();
}

async function phaseV1Off() {
  ctx.v2Profiles = null;
  await up();
  const F = await scenario('F_rest_fg_delete_v2off', { ws: 'W6', id: 'f' });
  check('F turn completed', F.turn?.status, 'COMPLETED');
  check('F delete refused without v2 advertisement', F.admit.split(' ')[0], '409');
  check('F no lifecycle operation row', F.opRowCount, 0);
  check('F Session stays ACTIVE', F.sessionAfter, 'ACTIVE');
  await down();
}

// Upgrade path: restart on another arm's jar against the database a previous l4 run left behind,
// and watch whether its RECOVERY_BLOCKED operations settle without any data change.
async function phaseResume() {
  ctx.v2Profiles = 'hosted-workspace-shell/1';
  const prev = JSON.parse(fs.readFileSync(process.env.RIG_PREV, 'utf8'));
  const keys = ['A_rest_fg_delete', 'C_rest_fg_close', 'D_web_fg_delete'];
  const before = Object.fromEntries(keys.map((k) => [k, { op: opRows(prev[k].sid)[0]?.[2] ?? null, session: sessStatus(prev[k].sid) }]));
  record('before', before);
  await up();
  const t0 = Date.now();
  const after = {};
  for (const k of keys) after[k] = null;
  while (Date.now() - t0 < Number(process.env.RIG_RESUME_MS ?? 240000) && keys.some((k) => !after[k])) {
    for (const k of keys) {
      if (after[k]) continue;
      const [oid, kind, st, err] = opRows(prev[k].sid)[0] ?? [];
      if (st === 'COMPLETED' || st === 'FAILED') after[k] = { op: st, error: err || null, atMs: Date.now() - t0, session: sessStatus(prev[k].sid), retirements: retirementCount(prev[k].sid) };
    }
    await sleep(1000);
  }
  for (const k of keys) {
    if (!after[k]) { const r = opRows(prev[k].sid)[0] ?? []; after[k] = { op: r[2] ?? null, error: r[3] || null, atMs: null, session: sessStatus(prev[k].sid), retirements: retirementCount(prev[k].sid) }; }
    check(`${k} settles after restart on ${arm}`, after[k].op, 'COMPLETED');
    check(`${k} Session reaches its terminal status`, after[k].session, k.includes('close') ? 'CLOSED' : 'DELETED');
  }
  record('after', after);
  await down();
}

// ---------- Round 3: lifecycle v2 fault cuts (exact head 86656d10) ----------
const liveWorkers = () => {
  let files = [];
  try { files = fs.readdirSync(ctx.runtimeState).filter((f) => f.endsWith('.json')); } catch {}
  return files.map((f) => { try { const j = JSON.parse(fs.readFileSync(`${ctx.runtimeState}/${f}`, 'utf8')); return { id: f.slice(0, 12), state: j.state, pid: j.pid }; } catch { return null; } }).filter(Boolean);
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function crash(rec) {
  try { process.kill(-rec.child.pid, 'SIGKILL'); } catch {}
  for (let i = 0; i < 100 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
}
const opMeta = (sid) => rows(sql(`SELECT state, COALESCE(error_code,''), claim_generation, attempt_count FROM managed_agent_operation WHERE session_id=${q(sid)} AND operation_kind IN ('CLOSE','DELETE') ORDER BY created_at`))
  .map(([state, err, gen, att]) => ({ state, error: err || null, claimGeneration: Number(gen), attempts: Number(att) }));
async function until(name, fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(200); } log('until timeout', name); return false; }

async function cutScenario(tag, { ws, id, kind = 'delete', fault }) {
  const S = { fault };
  tap.clear(); // never let an unconsumed rule from an earlier scenario catch this one
  const before = new Set(liveWorkers().map((w) => w.id));
  const c = await restCreate(ws, `FG::${id}`);
  const sid = c.json?.id;
  S.sid = sid; S.create = c.status;
  S.turn = await drive(sid);
  S.proof = proof(ws, id);
  S.workers = liveWorkers().filter((w) => !before.has(w.id));
  S.modelBefore = modelRequests(fake).length;
  const tapFrom = tap.seen.length;
  if (fault.type === 'kill-worker') {
    const w = S.workers.find((x) => x.pid && alive(x.pid));
    S.killedWorker = w ?? null;
    if (w) { process.kill(w.pid, 'SIGKILL'); await until('worker exit', () => !alive(w.pid), 10000); S.workerAliveAfterKill = alive(w.pid); }
  }
  if (fault.type === 'drop-reply') tap.rule({ phase: fault.phase, action: 'drop-reply' });
  if (fault.type === 'kill-harness') tap.rule({ phase: fault.phase, action: 'hold', name: `${tag}-1` });
  if (fault.type === 'kill-spring') { tap.rule({ phase: fault.phase, action: 'hold', name: `${tag}-1` }); tap.rule({ phase: fault.phase, action: 'hold', name: `${tag}-2` }); }
  const r = await lifecycle(sid, kind, false, `${tag}-${kind}`);
  S.admit = `${r.status} ${r.code ?? ''}`.trim();
  const opId = r.json?.id;
  const t0 = Date.now();
  if (fault.type === 'kill-harness') {
    S.held = await until('held', () => tap.held(`${tag}-1`), 90000);
    S.opWhileHeld = opMeta(sid);
    await crash(harness);
    S.harnessKilledAtMs = Date.now() - t0;
    tap.release(`${tag}-1`);
    harness = await startHarness(ctx, fake, `harness-${tag}`);
  }
  if (fault.type === 'kill-spring') {
    S.held = await until('held', () => tap.held(`${tag}-1`), 90000);
    S.opWhileHeld = opMeta(sid);
    // A JVM crash: SIGKILL the Spring pid alone, so the durable Runtime workers outlive it.
    try { process.kill(spring.child.pid, 'SIGKILL'); } catch {}
    await until('spring exit', () => spring.child.exitCode !== null || spring.child.signalCode !== null, 20000);
    S.springStoppedAtMs = Date.now() - t0;
    spring = await startSpring(ctx, springOver(), `spring-${tag}`);
    // The restarted Spring must wait out the old claim lease before it reclaims; its own request is held too.
    S.reclaimHeld = await until('reclaim held', () => tap.held(`${tag}-2`), 240000);
    S.opAtReclaim = opMeta(sid);
    // Replay the dead instance's request first (stale claim), then let the current claim through.
    tap.release(`${tag}-1`);
    await until('stale answered', () => tap.seen.slice(tapFrom).some((e) => e.released && e.claim === S.opWhileHeld[0]?.claimGeneration), 30000);
    tap.release(`${tag}-2`);
  }
  S.op = await waitOperation(sid, opId, Number(process.env.RIG_CUT_WAIT_MS ?? 300000));
  S.opMeta = opMeta(sid);
  S.sessionAfter = sessStatus(sid);
  S.retirements = retirementCount(sid);
  S.modelAfter = modelRequests(fake).length;
  S.proofAfter = proof(ws, id);
  S.tap = tap.seen.slice(tapFrom).map(({ t, phase, claim, action, upstream, code, released, clientGone }) => ({ t: t.slice(11, 23), phase, claim, action, upstream, code, ...(released ? { released, clientGone } : {}) }));
  S.workersAfter = S.workers.map((w) => ({ ...w, alive: w.pid ? alive(w.pid) : null, stateAfter: liveWorkers().find((x) => x.id === w.id)?.state ?? null }));
  if (S.op?.final?.status !== 'completed') { try { S.identityDiff = identityDiff(sid); } catch {} }
  record(tag, S);
  log(tag, JSON.stringify({ admit: S.admit, op: S.op?.final?.status, err: S.op?.final?.error ?? null, waitedMs: S.op?.waitedMs, session: S.sessionAfter, tap: S.tap.map((e) => `${e.phase}:${e.action}:${e.upstream}${e.code ? '/' + e.code : ''}`) }));
  return S;
}
function cutChecks(tag, S, terminal = 'DELETED') {
  check(`${tag} Shell turn completed and ran once`, [S.turn?.status, S.proof], ['COMPLETED', 'once\n']);
  check(`${tag} operation completed`, S.op?.final?.status, 'completed');
  check(`${tag} Session ${terminal}`, S.sessionAfter, terminal);
  if (terminal === 'DELETED') check(`${tag} one private-output retirement`, S.retirements, 1);
  check(`${tag} no model request during cleanup`, S.modelAfter - S.modelBefore, 0);
  check(`${tag} Shell not re-run by cleanup`, S.proofAfter, 'once\n');
}

async function phaseCut() {
  ctx.v2Profiles = 'hosted-workspace-shell/1';
  await up({ withTap: true });
  if (process.env.RIG_CUT_ONLY === 'x7x6') {
    const X7 = await cutScenario('X7_close_lost_reply_settle', { ws: 'W7', id: 'x7', kind: 'close', fault: { type: 'drop-reply', phase: 'settle_resources' } });
    cutChecks('X7', X7, 'CLOSED');
    const X6 = await cutScenario('X6_original_worker_killed', { ws: 'W6', id: 'x6', fault: { type: 'kill-worker' } });
    check('X6 original worker found and killed', [!!X6.killedWorker, X6.workerAliveAfterKill], [true, false]);
    cutChecks('X6', X6);
    await down();
    return;
  }
  const X1 = await cutScenario('X1_lost_reply_effects', { ws: 'W1', id: 'x1', fault: { type: 'drop-reply', phase: 'effects' } });
  cutChecks('X1', X1);
  check('X1 effects answered twice (lost, then retried)', X1.tap.filter((e) => e.phase === 'effects').length >= 2, true);
  const X2 = await cutScenario('X2_lost_reply_prepare', { ws: 'W2', id: 'x2', fault: { type: 'drop-reply', phase: 'prepare_resources' } });
  cutChecks('X2', X2);
  check('X2 prepare_resources retried after the lost reply', X2.tap.filter((e) => e.phase === 'prepare_resources').length >= 2, true);
  const X3 = await cutScenario('X3_lost_reply_settle', { ws: 'W3', id: 'x3', fault: { type: 'drop-reply', phase: 'settle_resources' } });
  cutChecks('X3', X3);
  check('X3 settle_resources retried after the lost reply', X3.tap.filter((e) => e.phase === 'settle_resources').length >= 2, true);
  const X4 = await cutScenario('X4_kill_harness_in_settle', { ws: 'W4', id: 'x4', fault: { type: 'kill-harness', phase: 'settle_resources' } });
  cutChecks('X4', X4);
  check('X4 Harness was killed while settle_resources was in flight', X4.held, true);
  const X5 = await cutScenario('X5_kill_spring_in_prepare', { ws: 'W5', id: 'x5', fault: { type: 'kill-spring', phase: 'prepare_resources' } });
  cutChecks('X5', X5);
  check('X5 restarted Spring reclaimed with a newer claim', (X5.opAtReclaim?.[0]?.claimGeneration ?? 0) > (X5.opWhileHeld?.[0]?.claimGeneration ?? 0), true);
  const stale = X5.tap.find((e) => e.released && e.claim === X5.opWhileHeld?.[0]?.claimGeneration);
  check('X5 dead instance prepare_resources (stale claim) refused by the Harness', stale ? (typeof stale.upstream === 'number' && stale.upstream >= 400) : 'not-replayed', true);
  record('X5_staleReply', stale ?? null);
  const X7 = await cutScenario('X7_close_lost_reply_settle', { ws: 'W7', id: 'x7', kind: 'close', fault: { type: 'drop-reply', phase: 'settle_resources' } });
  cutChecks('X7', X7, 'CLOSED');
  const X6 = await cutScenario('X6_original_worker_killed', { ws: 'W6', id: 'x6', fault: { type: 'kill-worker' } });
  check('X6 original worker found and killed', [!!X6.killedWorker, X6.workerAliveAfterKill], [true, false]);
  cutChecks('X6', X6);
  record('modelRequests', modelRequests(fake).length);
  await down();
}

// ---------- Round 3: MCP v2 with live stdio + streamable-HTTP servers ----------
// Spring never pins MCP servers into a Session (definitions refuse mcp_servers and the connector sends none),
// so the tap adds the pins to the Harness create/ordinary-load bodies, as a future control plane would.
const MCP = 'hosted-workspace-mcp/1';
let mcpHttp;
const sha = (t) => createHash('sha256').update(t).digest('hex');
const PINS = [
  { serverId: 'rig-stdio', serverRevision: 1, definitionDigest: sha('rig-stdio-v1') },
  { serverId: 'rig-http', serverRevision: 1, definitionDigest: sha('rig-http-v1') },
];
function mcpSetup() {
  const sdkFrom = `/root/pr13931-rig/src-${cliArm}/packages/cli/package.json`;
  ctx.stdioLog = `${ctx.runDir}/mcp-stdio.jsonl`;
  fs.writeFileSync(ctx.stdioLog, '');
  const servers = Object.keys(W).flatMap((w) => [
    { tenantId: T, workspaceId: w, serverId: 'rig-stdio', serverRevision: 1, definitionDigest: PINS[0].definitionDigest, transport: 'stdio',
      command: process.execPath, args: [`${ctx.runDir}/../../mcp-stdio.mjs`], env: { RIG_MCP_LOG: ctx.stdioLog, RIG_SDK_FROM: sdkFrom, RIG_MCP_NAME: `stdio-${w}` } },
    { tenantId: T, workspaceId: w, serverId: 'rig-http', serverRevision: 1, definitionDigest: PINS[1].definitionDigest, transport: 'streamable-http', url: mcpHttp.url },
  ]);
  const manifest = `${ctx.tmp}/mcp-manifest.json`;
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, servers }), { mode: 0o600 });
  ctx.springExtra = { QWEN_MANAGED_MCP_CONFIG: manifest, QWEN_MANAGED_AGENT_DEFINITION_TOOL_PROFILES: `hosted-workspace-files/1,${MCP}` };
}
const stdioEvents = (w) => (fs.existsSync(ctx.stdioLog) ? fs.readFileSync(ctx.stdioLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).filter((e) => e.server === `stdio-${w}`);
const stdioSummary = (w) => {
  const ev = stdioEvents(w);
  const pids = [...new Set(ev.filter((e) => e.ev === 'start').map((e) => e.pid))];
  return { started: pids.length, calls: ev.filter((e) => e.ev === 'call').length, ended: ev.filter((e) => ['exit', 'signal', 'stdin-end'].includes(e.ev)).map((e) => `${e.ev}${e.signal ? ':' + e.signal : ''}`), alive: pids.filter((p) => alive(p)).length, ppids: [...new Set(ev.filter((e) => e.ev === 'start').map((e) => e.ppid))] };
};
const httpSummary = (from) => {
  const ev = mcpHttp.events.slice(from);
  return { inits: ev.filter((e) => e.ev === 'session-init').length, calls: ev.filter((e) => e.ev === 'call').length, deletes: ev.filter((e) => e.ev === 'http' && e.method === 'DELETE').length, transportCloses: ev.filter((e) => e.ev === 'transport-close').length, sseClosed: ev.filter((e) => e.ev === 'sse-closed').length, live: mcpHttp.live().length };
};
async function defineMcpAgent() {
  const r = await api('op', 'POST', '/v1/agents', { model: {}, instructions: '', tools: [{ type: 'hosted_profile', profile: MCP }], permission_policy: { approval_mode: 'default' } }, { 'idempotency-key': `rig-mcp-agent-${ctx.db}` });
  log('define', r.status, r.code, r.json?.id);
  return r.json?.id;
}
async function mcpScenario(tag, { ws, id, agent, kind = 'delete', input = 'MCP', fault = null }) {
  const S = { fault };
  tap.clear(); // never let an unconsumed rule from an earlier scenario catch this one
  const before = new Set(liveWorkers().map((w) => w.id));
  const httpFrom = mcpHttp.events.length;
  const c = await api('op', 'POST', '/v1/agents/sessions', { agent_id: agent, workspace: { workspace_id: ws, cwd_relative: 'child' }, ...(input ? { input: [{ type: 'input_text', text: `${input}::${id}` }] } : {}), metadata: { title: `rig ${tag}` } }, { 'idempotency-key': randomUUID() });
  const sid = c.json?.id;
  S.sid = sid; S.create = `${c.status} ${c.code ?? ''}`.trim(); S.profile = sid ? profileOf(sid) : null;
  if (input) S.turn = await drive(sid); else for (let i = 0; i < 60 && sessStatus(sid) !== 'ACTIVE'; i++) await sleep(500);
  S.lastModelText = modelRequests(fake).filter((m) => m.id === id).map((m) => m.toolResults).at(-1) ?? null;
  S.catalog = await api('op', 'GET', `/v1/agents/sessions/${sid}/mcp-catalog`).then((r) => ({ status: r.status, servers: (r.json?.servers ?? r.json?.data ?? []).length ?? null })).catch((e) => String(e));
  S.workers = liveWorkers().filter((w) => !before.has(w.id));
  S.stdioBefore = stdioSummary(ws);
  S.httpBefore = httpSummary(httpFrom);
  S.modelBefore = modelRequests(fake).length;
  const tapFrom = tap.seen.length;
  if (fault?.type === 'kill-worker') {
    const w = S.workers.find((x) => x.pid && alive(x.pid));
    S.killedWorker = w ?? null;
    if (w) { process.kill(w.pid, 'SIGKILL'); await until('worker exit', () => !alive(w.pid), 10000); S.workerAliveAfterKill = alive(w.pid); }
    await sleep(1500);
    S.stdioAfterWorkerKill = stdioSummary(ws);
  }
  if (fault?.type === 'drop-reply') tap.rule({ phase: fault.phase, action: 'drop-reply' });
  const r = await lifecycle(sid, kind, false, `${tag}-${kind}`);
  S.admit = `${r.status} ${r.code ?? ''}`.trim();
  const opId = r.json?.id;
  if (r.status === 202 && opId) S.op = await waitOperation(sid, opId, Number(process.env.RIG_MCP_WAIT_MS ?? 240000));
  else S.opRowCount = opRows(sid).length;
  S.opMeta = opMeta(sid);
  S.sessionAfter = sessStatus(sid);
  S.retirements = retirementCount(sid);
  S.modelAfter = modelRequests(fake).length;
  await sleep(1000);
  S.stdioAfter = stdioSummary(ws);
  S.httpAfter = httpSummary(httpFrom);
  S.tap = tap.seen.slice(tapFrom).filter((e) => e.phase).map(({ phase, claim, action, upstream, code }) => ({ phase, claim, action, upstream, code }));
  S.workersAfter = S.workers.map((w) => ({ ...w, alive: w.pid ? alive(w.pid) : null, stateAfter: liveWorkers().find((x) => x.id === w.id)?.state ?? null }));
  record(tag, S);
  log(tag, JSON.stringify({ create: S.create, turn: S.turn?.status, admit: S.admit, op: S.op?.final?.status, err: S.op?.final?.error ?? null, session: S.sessionAfter, stdio: [S.stdioBefore, S.stdioAfter], http: [S.httpBefore, S.httpAfter], tap: S.tap.map((e) => `${e.phase}:${e.action}:${e.upstream}${e.code ? '/' + e.code : ''}`) }));
  return S;
}
async function mcpUp(v2Profiles) {
  ctx.v2Profiles = v2Profiles;
  await allocPorts(ctx);
  mcpHttp = await startMcpHttp(ctx, `/root/pr13931-rig/src-${cliArm}/packages/cli/package.json`);
  mcpSetup();
  await up({ withTap: true });
  tap.rewrite = (path, j) => (j.toolProfile === MCP && j.lifecycleAuthority === undefined && j.mcpServers === undefined ? { ...j, mcpServers: PINS } : undefined);
}
async function phaseMcp() {
  await mcpUp('hosted-workspace-shell/1,hosted-workspace-mcp/1');
  const agent = await defineMcpAgent();
  check('M agent definition with the MCP profile accepted', !!agent, true);
  const M1 = await mcpScenario('M1_mcp_both_delete', { ws: 'W1', id: 'm1', agent });
  check('M1 Session pinned to the MCP profile', M1.profile, MCP);
  check('M1 turn completed', M1.turn?.status, 'COMPLETED');
  check('M1 stdio tool called once, HTTP tool called once', [M1.stdioBefore.calls, M1.httpBefore.calls], [1, 1]);
  check('M1 stdio server alive before delete', M1.stdioBefore.alive >= 1, true);
  check('M1 delete operation completed', M1.op?.final?.status, 'completed');
  check('M1 Session DELETED', M1.sessionAfter, 'DELETED');
  check('M1 stdio server process gone after delete', M1.stdioAfter.alive, 0);
  check('M1 no model request during cleanup', M1.modelAfter - M1.modelBefore, 0);
  const M2 = await mcpScenario('M2_mcp_both_close', { ws: 'W2', id: 'm2', agent, kind: 'close' });
  check('M2 turn completed', M2.turn?.status, 'COMPLETED');
  check('M2 close operation completed', M2.op?.final?.status, 'completed');
  check('M2 Session CLOSED', M2.sessionAfter, 'CLOSED');
  check('M2 stdio server process gone after close', M2.stdioAfter.alive, 0);
  const M3 = await mcpScenario('M3_mcp_idle_delete', { ws: 'W3', id: 'm3', agent, input: null });
  check('M3 idle MCP Session delete completed', M3.op?.final?.status, 'completed');
  check('M3 Session DELETED', M3.sessionAfter, 'DELETED');
  const M5 = await mcpScenario('M5_mcp_lost_reply_settle', { ws: 'W5', id: 'm5', agent, input: 'MCPS', fault: { type: 'drop-reply', phase: 'settle_resources' } });
  check('M5 turn completed', M5.turn?.status, 'COMPLETED');
  check('M5 delete completed after a lost settle_resources reply', M5.op?.final?.status, 'completed');
  check('M5 settle_resources retried', M5.tap.filter((e) => e.phase === 'settle_resources').length >= 2, true);
  check('M5 stdio server process gone', M5.stdioAfter.alive, 0);
  const M4 = await mcpScenario('M4_mcp_worker_killed_delete', { ws: 'W4', id: 'm4', agent, fault: { type: 'kill-worker' } });
  check('M4 turn completed', M4.turn?.status, 'COMPLETED');
  check('M4 original worker found and killed', [!!M4.killedWorker, M4.workerAliveAfterKill], [true, false]);
  check('M4 delete completed through the stopped-worker path', M4.op?.final?.status, 'completed');
  check('M4 Session DELETED', M4.sessionAfter, 'DELETED');
  record('stdioOrphanAfterWorkerKill', M4.stdioAfterWorkerKill ?? null);
  record('modelRequests', modelRequests(fake).length);
  await down();
  try { mcpHttp.server.close(); } catch {}
}
async function phaseMcpOff() {
  await mcpUp('hosted-workspace-shell/1');
  const agent = await defineMcpAgent();
  const N = await mcpScenario('N_mcp_delete_v2_not_advertised', { ws: 'W6', id: 'n1', agent });
  check('N turn completed', N.turn?.status, 'COMPLETED');
  check('N delete refused when MCP v2 is not advertised', N.admit.split(' ')[0], '409');
  check('N no lifecycle operation row', N.opRowCount, 0);
  check('N Session stays ACTIVE', N.sessionAfter, 'ACTIVE');
  check('N stdio server still alive', N.stdioAfter.alive >= 1, true);
  await down();
  try { mcpHttp.server.close(); } catch {}
}

// ---------- Round 3: DRAINING gap longer than the Session Store writer lease (no crash) ----------
const writerLease = (sid) => sql(`SELECT CONCAT(writer_generation, ' ', DATE_FORMAT(writer_lease_until, '%H:%i:%s.%f')) FROM qwen_managed_session_journal_head WHERE session_id=${q(sid)}`);
async function holdScenario(tag, { ws, id, holdMs, restartHarnessAfter = false, phaseName = 'prepare_resources' }) {
  const S = { holdMs };
  tap.clear(); // never let an unconsumed rule from an earlier scenario catch this one
  const c = await restCreate(ws, `FG::${id}`);
  const sid = c.json?.id; S.sid = sid;
  S.turn = await drive(sid);
  S.proof = proof(ws, id);
  S.modelBefore = modelRequests(fake).length;
  S.writerBefore = writerLease(sid);
  const tapFrom = tap.seen.length;
  tap.rule({ phase: phaseName, action: 'hold', name: `${tag}-1` });
  const r = await lifecycle(sid, 'delete', false, `${tag}-delete`);
  S.admit = `${r.status} ${r.code ?? ''}`.trim();
  const opId = r.json?.id;
  S.held = await until('held', () => tap.held(`${tag}-1`), 60000);
  const tHeld = Date.now();
  S.opWhileHeld = opMeta(sid);
  await sleep(holdMs);
  S.writerAtRelease = writerLease(sid);
  S.dbNowAtRelease = sql(`SELECT DATE_FORMAT(NOW(6), '%H:%i:%s.%f')`);
  tap.release(`${tag}-1`);
  S.op = await waitOperation(sid, opId, Number(process.env.RIG_HOLD_WAIT_MS ?? 150000));
  S.opMeta = opMeta(sid);
  S.sessionAfter = sessStatus(sid);
  S.writerAfter = writerLease(sid);
  S.tap = tap.seen.slice(tapFrom).filter((e) => e.phase).map(({ t, phase, claim, action, upstream, code }) => ({ t: t.slice(11, 23), phase, claim, action, upstream, code }));
  if (restartHarnessAfter && S.op?.final?.status !== 'completed') {
    const t1 = Date.now();
    await crash(harness);
    harness = await startHarness(ctx, fake, `harness-${tag}`);
    S.afterHarnessRestart = await waitOperation(sid, opId, 240000);
    S.afterHarnessRestart.sinceRestartMs = Date.now() - t1;
    S.sessionAfterRestart = sessStatus(sid);
    S.retirementsAfterRestart = retirementCount(sid);
    S.writerAfterRestart = writerLease(sid);
    S.tapAfterRestart = tap.seen.slice(tapFrom).filter((e) => e.phase).length;
  }
  S.modelAfter = modelRequests(fake).length;
  S.proofAfter = proof(ws, id);
  record(tag, S);
  log(tag, JSON.stringify({ holdMs, op: S.op?.final?.status, err: S.op?.final?.error ?? null, opMeta: S.opMeta, session: S.sessionAfter, writer: [S.writerBefore, S.writerAtRelease, S.dbNowAtRelease, S.writerAfter], tap: S.tap.map((e) => `${e.phase}:${e.action}:${e.upstream}${e.code ? '/' + e.code : ''}`), restart: S.afterHarnessRestart ? [S.afterHarnessRestart.final?.status, S.sessionAfterRestart, S.afterHarnessRestart.sinceRestartMs] : null }));
  return S;
}
async function phaseLease() {
  ctx.v2Profiles = 'hosted-workspace-shell/1';
  const L = Number(process.env.RIG_WRITER_LEASE_S ?? 15);
  ctx.springExtra = { QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: `${L}s` };
  record('writerLeaseSeconds', L);
  await up({ withTap: true });
  const shortMs = Number(process.env.RIG_SHORT_HOLD_MS ?? 5000);
  const longMs = Number(process.env.RIG_LONG_HOLD_MS ?? (L + 25) * 1000);
  const Z2 = await holdScenario('Z2_hold_prepare_short', { ws: 'W1', id: 'z2', holdMs: shortMs });
  check(`Z2 prepare_resources held ${shortMs / 1000}s (< ${L}s writer lease): delete completed`, Z2.op?.final?.status, 'completed');
  check('Z2 Session DELETED', Z2.sessionAfter, 'DELETED');
  const Z1 = await holdScenario('Z1_hold_prepare_long', { ws: 'W2', id: 'z1', holdMs: longMs, restartHarnessAfter: true });
  check(`Z1 prepare_resources held ${longMs / 1000}s (> ${L}s writer lease): delete completed`, Z1.op?.final?.status, 'completed');
  check('Z1 Session DELETED', Z1.sessionAfter, 'DELETED');
  record('Z1_afterHarnessRestart', Z1.afterHarnessRestart ? { status: Z1.afterHarnessRestart.final?.status, session: Z1.sessionAfterRestart, retirements: Z1.retirementsAfterRestart, sinceRestartMs: Z1.afterHarnessRestart.sinceRestartMs } : null);
  check('Z1 no model request during cleanup', Z1.modelAfter - Z1.modelBefore, 0);
  if (process.env.RIG_LEASE_X5 === '1') {
    const X5 = await cutScenario('X5L_kill_spring_in_prepare', { ws: 'W3', id: 'x5l', fault: { type: 'kill-spring', phase: 'prepare_resources' } });
    check(`X5L (writer lease ${L}s) operation completed after Spring crash`, X5.op?.final?.status, 'completed');
    check('X5L Session DELETED', X5.sessionAfter, 'DELETED');
  }
  await down();
}

// ---------- Round 3: idle longer than the writer lease, then delete (no fault, no hold) ----------
async function idleScenario(tag, { ws, id, idleMs, kind = 'delete' }) {
  const S = { idleMs };
  tap.clear();
  const c = await restCreate(ws, `FG::${id}`);
  const sid = c.json?.id; S.sid = sid;
  S.turn = await drive(sid);
  S.samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < idleMs) { S.samples.push({ atS: Math.round((Date.now() - t0) / 1000), writer: writerLease(sid), dbNow: sql(`SELECT DATE_FORMAT(NOW(6), '%H:%i:%s')`), status: sessStatus(sid) }); await sleep(5000); }
  const tapFrom = tap.seen.length;
  const r = await lifecycle(sid, kind, false, `${tag}-${kind}`);
  S.admit = `${r.status} ${r.code ?? ''}`.trim();
  S.op = await waitOperation(sid, r.json?.id, Number(process.env.RIG_HOLD_WAIT_MS ?? 120000));
  S.opMeta = opMeta(sid);
  S.sessionAfter = sessStatus(sid);
  S.tap = tap.seen.slice(tapFrom).filter((e) => e.phase).map(({ phase, claim, action, upstream, code }) => ({ phase, claim, action, upstream, code }));
  record(tag, S);
  log(tag, JSON.stringify({ idleMs, admit: S.admit, op: S.op?.final?.status, session: S.sessionAfter, samples: S.samples.map((x) => `${x.atS}s:${x.writer}@${x.dbNow}`), tap: S.tap.map((e) => `${e.phase}:${e.upstream}${e.code ? '/' + e.code : ''}`) }));
  return S;
}
async function phaseIdle() {
  ctx.v2Profiles = 'hosted-workspace-shell/1';
  const L = Number(process.env.RIG_WRITER_LEASE_S ?? 15);
  ctx.springExtra = { QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: `${L}s` };
  await up({ withTap: true });
  const I1 = await idleScenario('I1_idle_then_delete', { ws: 'W1', id: 'i1', idleMs: (L + 25) * 1000 });
  check(`I1 idle ${L + 25}s (> ${L}s writer lease) then delete completed`, I1.op?.final?.status, 'completed');
  const I2 = await idleScenario('I2_idle_then_close', { ws: 'W2', id: 'i2', idleMs: (L + 25) * 1000, kind: 'close' });
  check(`I2 idle ${L + 25}s then close completed`, I2.op?.final?.status, 'completed');
  await down();
}

try {
  if (phase === 'resume') await phaseResume();
  else if (phase === 'l4') await phaseL4();
  else if (phase === 'v1off') await phaseV1Off();
  else if (phase === 'l4x') await phaseL4x();
  else if (phase === 'cut') await phaseCut();
  else if (phase === 'mcp') await phaseMcp();
  else if (phase === 'lease') await phaseLease();
  else if (phase === 'idle') await phaseIdle();
  else if (phase === 'mcpoff') await phaseMcpOff();
  else throw new Error(`unknown phase ${phase}`);
} catch (e) {
  log('PHASE ERROR', e.stack ?? String(e));
  record('phaseError', String(e.stack ?? e));
  try { await down(); } catch {}
  process.exitCode = 1;
}
const fails = ctx.results.checks.filter((c) => !c.pass).length;
log(`RESULT ${phase} ${arm} pass=${ctx.results.checks.length - fails} fail=${fails}`);
