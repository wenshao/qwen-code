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

let fake, spring, harness;
async function up() {
  await allocPorts(ctx);
  fake = await startFakeModel(ctx);
  spring = await startSpring(ctx, { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'true' });
  seedRegistry();
  harness = await startHarness(ctx, fake);
}
async function down() {
  await stop(harness);
  await stop(spring);
  try { fake?.server.close(); } catch {}
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

try {
  if (phase === 'resume') await phaseResume();
  else if (phase === 'l4') await phaseL4();
  else if (phase === 'v1off') await phaseV1Off();
  else if (phase === 'l4x') await phaseL4x();
  else throw new Error(`unknown phase ${phase}`);
} catch (e) {
  log('PHASE ERROR', e.stack ?? String(e));
  record('phaseError', String(e.stack ?? e));
  try { await down(); } catch {}
  process.exitCode = 1;
}
const fails = ctx.results.checks.filter((c) => !c.pass).length;
log(`RESULT ${phase} ${arm} pass=${ctx.results.checks.length - fails} fail=${fails}`);
