// PR #13674 real-stack scenarios.
// Usage: node rig.mjs <boot|on|off|on2|yolo-off|rollback> <arm> <db> [--hold]
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  RIG, T, sleep, makeCtx, sqlFor, sqlRaw, q, rows, startFakeModel, modelRequests, start, stop, waitFor,
  allocPorts, startSpring, startHarness, apiFor, springEnv, mountArgs,
} from './lib.mjs';

const [phase, arm, db, ...flags] = process.argv.slice(2);
const HOLD = flags.includes('--hold');
const cliArm = process.env.RIG_CLI_ARM ?? (arm === 'base' ? 'head' : arm);
const ctx = makeCtx({ phase, arm, db, cliArm });
ctx.STORAGES = ['st1', 'st2', 'st3', 'st4', 'st5'];
for (const st of ctx.STORAGES) for (const c of ['child', 'c2']) fs.mkdirSync(`${ctx.mount(st)}/${c}`, { recursive: true });
const sql = sqlFor(ctx);
const api = apiFor(ctx);
const { log, check, record, state, saveState } = ctx;
const W = { W1: 'st1', W2: 'st2', W3: 'st3', W4: 'st4', W5: 'st5' };

// ---------- helpers ----------
const turnsOf = (sid) => rows(sql(`SELECT turn_id, status, COALESCE(error_code,'') FROM managed_agent_turn WHERE session_id=${q(sid)} ORDER BY created_at, turn_id`));
const turnCount = (sid) => Number(sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id=${q(sid)}`));
const opCount = (sid) => Number(sql(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id=${q(sid)} AND operation_kind IN ('CLOSE','ARCHIVE','UNARCHIVE','DELETE')`));
const cmdCount = (sid) => Number(sql(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id=${q(sid)}`));
let hasParentCol;
const hasParentColumn = () => (hasParentCol ??= sql(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=${q(db)} AND table_name='managed_agent_session' AND column_name='parent_session_id'`) === '1');
const sessRow = (sid) => {
  hasParentCol ??= sql(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=${q(db)} AND table_name='managed_agent_session' AND column_name='parent_session_id'`) === '1';
  const r = rows(sql(`SELECT status, COALESCE(tool_profile,'(null)'), COALESCE(approval_mode,'(null)'), COALESCE(CAST(creator_actor_key AS CHAR),'(null)'), COALESCE(CAST(owner_actor_key AS CHAR),'(null)'), ${hasParentCol ? "COALESCE(parent_session_id,'')" : "''"} FROM managed_agent_session WHERE session_id=${q(sid)}`))[0];
  return r ? { status: r[0], profile: r[1], approval: r[2], creator: r[3], owner: r[4], parent: r[5] || null } : null;
};
async function waitTurn(sid, turnId, want = ['COMPLETED', 'FAILED', 'CANCELLED'], timeoutMs = 120000, poll) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    if (poll) await poll();
    const t = turnsOf(sid).find((r) => !turnId || r[0] === turnId) ?? null;
    last = t;
    if (t && want.includes(t[1])) return { turn: t[0], status: t[1], error: t[2] || null };
    await sleep(300);
  }
  return { turn: last?.[0] ?? null, status: `TIMEOUT(last=${last?.[1] ?? 'none'})`, error: last?.[2] || null };
}
async function listActions(sid, actor = 'op', web = false) {
  const r = web
    ? await api(actor, 'POST', '/api/agent/web-shell/v1/actions/query', { sessionId: sid })
    : await api(actor, 'GET', `/v1/agents/sessions/${sid}/actions`);
  return r;
}
async function waitAction(sid, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await listActions(sid);
    const open = (r.json?.data ?? []).filter((a) => (a.status ?? a.state) === 'requested' || !(a.status ?? a.state));
    if (open.length) return open[0];
    await sleep(300);
  }
  return null;
}
async function respond(sid, action, option, actor = 'op', web = false, key) {
  const id = action.id ?? action.actionId;
  if (web) {
    const wa = (await listActions(sid, actor, true)).json?.data?.find((a) => a.actionId === id) ?? null;
    const body = { sessionId: sid, actionId: id, idempotencyKey: key ?? `${id}:${option}`, requestId: 'rig', response: { kind: 'permission', optionId: option, inputRevision: wa?.inputRevision ?? action.input_revision, policyRevision: wa?.policyRevision ?? action.policy_revision } };
    return api(actor, 'POST', '/api/agent/web-shell/v1/actions/respond', body);
  }
  return api(actor, 'POST', `/v1/agents/sessions/${sid}/actions/${id}/responses`, { kind: 'permission', option_id: option, input_revision: action.input_revision, policy_revision: action.policy_revision }, { 'idempotency-key': key ?? `${id}:${option}` });
}
const restCreate = (actor, ws, input, key = randomUUID(), cwd = 'child') =>
  api(actor, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(ws ? { workspace: { workspace_id: ws, cwd_relative: cwd } } : {}), ...(input ? { input: [{ type: 'input_text', text: input }] } : {}), metadata: { title: `rig ${input ?? 'empty'}` } }, { 'idempotency-key': key });
const webCreate = (actor, ws, input, key = randomUUID(), cwd = 'child') =>
  api(actor, 'POST', '/api/agent/web-shell/v1/sessions/create', { idempotencyKey: key, agentId: 'qwen-code', title: `rig web ${input ?? 'empty'}`, input: input ? [{ type: 'input_text', text: input }] : [], ...(ws ? { workspace: { workspaceId: ws, cwdRelative: cwd } } : {}) });
const restSubmit = (actor, sid, text, key = randomUUID()) =>
  api(actor, 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text }] }, { 'idempotency-key': key });
const webSubmit = (actor, sid, text, key = randomUUID()) =>
  api(actor, 'POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: sid, idempotencyKey: key, input: [{ type: 'input_text', text }] });
const restGet = (actor, sid) => api(actor, 'GET', `/v1/agents/sessions/${sid}`);
const webGet = (actor, sid) => api(actor, 'POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: sid });
const capsOf = (r) => r.json?.capabilities ?? r.json?.session?.capabilities ?? null;
const pickCaps = (c) => (c ? Object.fromEntries(Object.entries(c).filter(([k]) => /shell|turn|close|archive|delete|action|send|foreground/i.test(k))) : null);
const fileText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const listDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
function proofFiles(ws) { return listDir(`${ctx.mount(W[ws])}/child`); }
function decoyFiles() { return listDir(ctx.workspace).filter((f) => !f.startsWith('.')); }

async function lifecycleProbe(sid, web, tag) {
  const out = {};
  for (const kind of ['close', 'archive', 'unarchive', 'delete']) {
    let r;
    if (web) r = await api('op', 'POST', `/api/agent/web-shell/v1/sessions/${kind}`, { sessionId: sid, idempotencyKey: `${tag}-${kind}` });
    else if (kind === 'delete') r = await api('op', 'DELETE', `/v1/agents/sessions/${sid}`, null, { 'idempotency-key': `${tag}-${kind}` });
    else r = await api('op', 'POST', `/v1/agents/sessions/${sid}/${kind}`, null, { 'idempotency-key': `${tag}-${kind}` });
    out[kind] = `${r.status} ${r.code}`;
  }
  return out;
}

let fake, spring, harness;
async function up(over = {}) {
  await allocPorts(ctx);
  fake = await startFakeModel(ctx);
  spring = await startSpring(ctx, over);
  harness = await startHarness(ctx, fake);
}
async function down() {
  await stop(harness);
  await stop(spring);
  // Runtime workers detach; collect them by the rig's runtime-state path, PID only.
  const ps = sqlRaw; // keep lint quiet
  void ps;
  try { fake?.server.close(); } catch {}
}
async function holdOpen(tag) {
  if (!HOLD) return;
  const flag = `${ctx.runDir}/release-${tag}`;
  fs.writeFileSync(`${ctx.runDir}/holding-${tag}`, JSON.stringify({ springPort: ctx.springPort, state: ctx.state.sessions }, null, 2));
  log(`HOLDING ${tag}: touch ${flag} to continue`);
  while (!fs.existsSync(flag)) await sleep(500);
}

// ---------- phases ----------
async function phaseBoot() {
  // Startup validation matrix: Spring only (no Harness), fresh DB per arm.
  sql; // db must exist
  await allocPorts(ctx);
  ctx.harnessPort = 1; // never contacted at boot
  const variants = [
    ['shell=unset approval=default (files on)', {}],
    ['shell=true approval=default', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' }],
    ['shell=true approval=DEFAULT', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: 'DEFAULT' }],
    ['shell=true approval=auto-edit', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: 'auto-edit' }],
    ['shell=true approval=unset(->yolo)', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: null }],
    ['shell=true approval=yolo', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo' }],
    ['shell=true approval=blank', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: '' }],
    ['shell=true approval=plan', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: 'plan' }],
    ['shell=true approval=" default"', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: ' default' }],
    ['shell=true files=false approval=default', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'false' }],
    ['shell=true harness=false files=false', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'false', QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'false' }],
    ['shell=false approval=yolo', { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'false', QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo' }],
  ];
  const out = [];
  for (const [i, [label, over]] of variants.entries()) {
    const name = `spring-boot-${i}`;
    const t = Date.now();
    const rec = start(ctx, name, process.env.RIG_JAVA ?? `${process.env.HOME}/Install/jdk21/bin/java`, ['-jar', ctx.springJar, ...mountArgs(ctx)], springEnv(ctx, over));
    let outcome;
    try {
      await waitFor(name, async () => (await fetch(`http://127.0.0.1:${ctx.springPort}/actuator/health`)).ok, 180000, rec);
      outcome = 'BOOTED';
    } catch (e) {
      outcome = /exited early/.test(e.message) ? 'EXITED' : 'TIMEOUT';
    }
    await stop(rec);
    const logText = fs.readFileSync(`${ctx.runDir}/${name}.log`, 'utf8');
    const reason = (logText.match(/IllegalStateException: ([^\n]+)/) ?? logText.match(/Caused by: [\w.]+: ([^\n]+)/))?.[1] ?? null;
    out.push({ label, outcome, ms: Date.now() - t, reason: outcome === 'BOOTED' ? null : reason });
    log('boot', label, outcome, reason);
  }
  record('bootMatrix', out);
}

function seedRegistry() {
  const reg = (w, st) => `INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(T)}, '${w}', 1, '${st}', 'Rig ${w}', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`;
  const grant = (w, a, role) => `INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, '${w}', '${a}', '${role}')`;
  sql([...Object.entries(W).map(([w, st]) => reg(w, st)), ...Object.keys(W).map((w) => grant(w, 'op', 'OPERATOR')), grant('W1', 'rd', 'READER')].join(';'));
}

async function phaseOn() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  state.sessions ??= {};
  state.keys ??= {};
  // A: REST create with input; Allow.
  state.keys.createA = randomUUID();
  const a = await restCreate('op', 'W1', 'SHELL::a please run it', state.keys.createA);
  const A = a.json?.id;
  state.sessions.A = A; saveState();
  check('A REST create 202', a.status, 202);
  check('A create capabilities.foreground_shell', a.json?.capabilities?.foreground_shell ?? '(absent)', true);
  record('A.createCaps', a.json?.capabilities);
  const actA = await waitAction(A);
  record('A.action', actA);
  check('A action requested', !!actA, true);
  check('A action shows the command', JSON.stringify(actA ?? {}).includes("printf 'once\\\\n' >> shell-proof-a.txt") || JSON.stringify(actA ?? {}).includes('shell-proof-a.txt'), true);
  const rdA = await respond(A, actA, 'allow', 'rd');
  check('A reader respond -> 403', `${rdA.status} ${rdA.code}`, '403 action_forbidden');
  const okA = await respond(A, actA, 'allow');
  check('A creator allow -> 202', okA.status, 202);
  const tA = await waitTurn(A);
  check('A turn completes', tA.status, 'COMPLETED');
  check('A proof file once', fileText(`${ctx.mount('st1')}/child/shell-proof-a.txt`), 'once\n');
  check('A no monitor/background proof', proofFiles('W1').filter((f) => /monitor|background/.test(f)), []);
  check('A decoy untouched', decoyFiles(), []);
  const rowA = sessRow(A);
  record('A.row', rowA);
  check('A DB profile/approval', [rowA?.status, rowA?.profile, rowA?.approval], ['ACTIVE', 'hosted-workspace-shell/1', 'default']);
  check('A creator==owner (non-null)', rowA?.creator !== '(null)' && rowA?.creator === rowA?.owner, true);
  // B: WebShell create empty + submit; Deny.
  state.keys.createB = randomUUID();
  const b = await webCreate('op', 'W2', null, state.keys.createB);
  const B = b.json?.sessionId;
  state.sessions.B = B; saveState();
  check('B WebShell create', b.status, 202);
  const bg = await webGet('op', B);
  record('B.webCaps', capsOf(bg));
  check('B WebShell foregroundShell', capsOf(bg)?.foregroundShell ?? '(absent)', true);
  state.keys.turnB = randomUUID();
  const sb = await webSubmit('op', B, 'SHELL::b please run it', state.keys.turnB);
  check('B submit 202', sb.status, 202);
  state.turnB = sb.json?.turnId; saveState();
  const actB = await waitAction(B);
  const denyB = await respond(B, actB, 'deny', 'op', true);
  check('B WebShell deny -> 202', denyB.status, 202);
  const tB = await waitTurn(B);
  check('B turn completes after deny', tB.status, 'COMPLETED');
  check('B no proof files', proofFiles('W2').filter((f) => /proof/.test(f)), []);
  // Model-side view: tool vocabulary and refusals.
  const reqs = modelRequests(fake);
  const ra = reqs.filter((r) => r.kind === 'SHELL' && r.id === 'a');
  record('A.modelRequests', ra);
  check('A tools advertised', [...new Set(ra.map((r) => r.tools.slice().sort().join(',')))], [ra[0]?.tools.slice().sort().join(',')]);
  record('toolsAdvertisedShell', ra[0]?.tools.slice().sort());
  check('A monitor refused (step1 result)', /Monitor is unavailable|monitor/i.test(ra.find((r) => r.step === 1)?.toolResults?.[0] ?? ''), true);
  check('A background refused (step2 result)', /foreground command|background/i.test(ra.find((r) => r.step === 2)?.toolResults?.[1] ?? ''), true);
  // REST and WebShell capability snapshots.
  record('A.restCaps', capsOf(await restGet('op', A)));
  // Lifecycle refusal.
  const lcA = await lifecycleProbe(A, false, 'on-A');
  const lcB = await lifecycleProbe(B, true, 'on-B');
  record('lifecycle.on', { A: lcA, B: lcB });
  check('A REST lifecycle refused', lcA, { close: '409 workspace_unavailable', archive: '409 workspace_unavailable', unarchive: '409 workspace_unavailable', delete: '409 workspace_unavailable' });
  check('B WebShell lifecycle refused', lcB, { close: '409 workspace_unavailable', archive: '409 workspace_unavailable', unarchive: '409 workspace_unavailable', delete: '409 workspace_unavailable' });
  check('no lifecycle operations', [opCount(A), opCount(B)], [0, 0]);
  if (process.env.RIG_MINI) { record('turns', { A: turnsOf(A), B: turnsOf(B) }); await down(); return; }
  const rdOn = await restSubmit('rd', A, 'SHELL::a3 reader');
  record('on.readerFreshTurn', `${rdOn.status} ${rdOn.code}`);
  // Creation replay.
  const ra2 = await restCreate('op', 'W1', 'SHELL::a please run it', state.keys.createA);
  check('A creation replay same id', ra2.json?.id === A, true);
  // Unbound Session: no foreground_shell.
  const u = await restCreate('op', null, null);
  state.sessions.U = u.json?.id; saveState();
  check('unbound create caps omit foreground_shell', 'foreground_shell' in (u.json?.capabilities ?? {}), false);
  check('unbound tool_profile', sessRow(u.json?.id)?.profile, '(null)');
  // P: pending approval left open across the restart.
  state.keys.createP = randomUUID();
  const p = await restCreate('op', 'W1', 'PEND::p hold for approval', state.keys.createP);
  state.sessions.P = p.json?.id; saveState();
  const actP = await waitAction(state.sessions.P);
  state.actionP = actP; saveState();
  check('P action requested before restart', !!actP, true);
  // H: running Turn held at the model across the restart.
  const h = await restCreate('op', 'W3', 'HOLD::h keep running', randomUUID());
  state.sessions.H = h.json?.id; saveState();
  await waitTurn(state.sessions.H, null, ['RUNNING'], 60000);
  state.turnH = turnsOf(state.sessions.H)[0]?.[0]; saveState();
  check('H running before restart', turnsOf(state.sessions.H)[0]?.[1], 'RUNNING');
  // H2: second held Turn, cancelled BEFORE the restart (control for the cancel path).
  const h2 = await restCreate('op', 'W4', 'HOLD::h2 keep running', randomUUID());
  const H2 = h2.json?.id;
  state.sessions.H2 = H2; saveState();
  await waitTurn(H2, null, ['RUNNING'], 60000);
  const c2 = await api('op', 'POST', `/v1/agents/sessions/${H2}/events`, { type: 'agent.session.cancel', turn_id: turnsOf(H2)[0][0] }, { 'idempotency-key': randomUUID() });
  check('H2 cancel (flag on, no restart) -> 202', c2.status, 202);
  const tH2 = await waitTurn(H2);
  check('H2 cancelled', tH2.status, 'CANCELLED');
  record('turns', Object.fromEntries(Object.entries(state.sessions).map(([k, v]) => [k, turnsOf(v)])));
  await holdOpen('on');
  await down();
}

async function phaseOff(over = {}, tag = 'off') {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: null, ...over });
  const { A, B, P, H, U } = state.sessions;
  // Capabilities after the restart.
  const ca = capsOf(await restGet('op', A));
  const cb = capsOf(await webGet('op', B));
  record(`${tag}.A.restCaps`, ca);
  record(`${tag}.B.webCaps`, cb);
  check(`${tag}: A foreground_shell false`, ca?.foreground_shell ?? '(absent)', false);
  check(`${tag}: B WebShell foregroundShell false`, cb?.foregroundShell ?? '(absent)', false);
  check(`${tag}: U still omits foreground_shell`, 'foreground_shell' in (capsOf(await restGet('op', U)) ?? {}), false);
  // Fresh Turns refused.
  const before = [turnCount(A), turnCount(B), cmdCount(A), cmdCount(B)];
  const fa = await restSubmit('op', A, 'SHELL::a2 fresh after flag off');
  const fb = await webSubmit('op', B, 'SHELL::b2 fresh after flag off');
  check(`${tag}: A fresh REST turn refused`, `${fa.status} ${fa.code}`, '409 workspace_unavailable');
  check(`${tag}: B fresh WebShell turn refused`, `${fb.status} ${fb.code}`, '409 workspace_unavailable');
  check(`${tag}: no new turn rows/commands`, [turnCount(A), turnCount(B), cmdCount(A), cmdCount(B)], before);
  // Reader: authorization still runs first (404/403 before the Shell gate).
  const rdA = await restSubmit('rd', A, 'SHELL::a3 reader');
  record(`${tag}.readerFreshTurn`, `${rdA.status} ${rdA.code}`);
  // Replays.
  const rc = await restCreate('op', 'W1', 'SHELL::a please run it', state.keys.createA);
  check(`${tag}: A creation replay same id`, `${rc.status} ${rc.json?.id === A}`, '202 true');
  const rt = await webSubmit('op', B, 'SHELL::b please run it', state.keys.turnB);
  check(`${tag}: B turn-key replay same turn`, `${rt.status} ${rt.json?.turnId === state.turnB}`, '202 true');
  // New creation with the flag off -> files/1.
  const n = await restCreate('op', 'W2', null);
  state.sessions[`N_${tag}`] = n.json?.id; saveState();
  check(`${tag}: new creation profile`, sessRow(n.json?.id)?.profile, 'hosted-workspace-files/1');
  check(`${tag}: new creation omits foreground_shell`, 'foreground_shell' in (n.json?.capabilities ?? {}), false);
  // W2 cwd change on a Shell Session still admitted.
  const g = await restGet('op', A);
  const rev = g.json?.workspace?.context_revision ?? g.json?.context_revision ?? 0;
  const cwd = await api('op', 'POST', `/v1/agents/sessions/${A}/cwd`, { cwd_relative: 'c2', expected_context_revision: rev }, { 'idempotency-key': randomUUID() });
  let cwdOp = null;
  if (cwd.status === 202 && cwd.json?.id) {
    for (let i = 0; i < 200; i++) {
      const o = await api('op', 'GET', `/v1/agents/sessions/${A}/operations/${cwd.json.id}`);
      cwdOp = o.json?.status ?? o.json?.state;
      if (/completed|failed/i.test(cwdOp ?? '')) break;
      await sleep(300);
    }
  }
  record(`${tag}.cwdChange`, { status: cwd.status, code: cwd.code, op: cwdOp });
  // Lifecycle still refused.
  const lc = await lifecycleProbe(A, false, `${tag}-A`);
  record(`lifecycle.${tag}`, lc);
  check(`${tag}: A lifecycle refused`, Object.values(lc).every((v) => v.startsWith('409')), true);
  check(`${tag}: no lifecycle operations`, opCount(A), 0);
  await holdOpen(`${tag}-before-accepted`);
  // Accepted work across the restart: pending approval P, running Turn H.
  const actions = await listActions(P);
  record(`${tag}.P.actions`, actions.json);
  const actP = (actions.json?.data ?? []).find((x) => x.id === state.actionP?.id) ?? null;
  check(`${tag}: P action still requested`, actP?.status ?? actP?.state ?? '(missing)', 'requested');
  if (actP) {
    const r = await respond(P, actP, 'allow');
    check(`${tag}: P allow accepted`, r.status, 202);
    const tP = await waitTurn(P, null, ['COMPLETED', 'FAILED', 'CANCELLED'], Number(process.env.RIG_P_WAIT_MS ?? 300000));
    record(`${tag}.P.turn`, tP);
    check(`${tag}: P turn settles`, tP.status, 'COMPLETED');
    check(`${tag}: P proof once`, fileText(`${ctx.mount('st1')}/child/pend-proof-p.txt`), 'pend\n');
  }
  const ch = await api('op', 'POST', `/v1/agents/sessions/${H}/events`, { type: 'agent.session.cancel', turn_id: state.turnH }, { 'idempotency-key': `${tag}-cancel-H` });
  record(`${tag}.H.cancel`, { status: ch.status, code: ch.code, body: ch.json });
  check(`${tag}: H cancel accepted`, ch.status, 202);
  const tH = await waitTurn(H, state.turnH, ['CANCELLED', 'FAILED', 'COMPLETED'], 120000);
  record(`${tag}.H.turn`, tH);
  check(`${tag}: H turn cancelled`, tH.status, 'CANCELLED');
  record(`${tag}.turns`, Object.fromEntries(Object.entries(state.sessions).map(([k, v]) => [k, turnsOf(v)])));
  await holdOpen(`${tag}-after`);
  await down();
}

async function phaseRestartOn() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  const { A, P, H } = state.sessions;
  record('ctl.A.restCaps', capsOf(await restGet('op', A)));
  const rd = await restSubmit('rd', A, 'SHELL::a3 reader');
  record('ctl.readerFreshTurn', `${rd.status} ${rd.code}`);
  const actions = await listActions(P);
  const actP = (actions.json?.data ?? []).find((x) => x.id === state.actionP?.id) ?? null;
  check('ctl: P action still requested', actP?.state ?? '(missing)', 'requested');
  if (actP) {
    const r = await respond(P, actP, 'allow');
    check('ctl: P allow accepted', r.status, 202);
    const tP = await waitTurn(P, null, ['COMPLETED', 'FAILED', 'CANCELLED'], Number(process.env.RIG_P_WAIT_MS ?? 300000));
    record('ctl.P.turn', tP);
    record('ctl.P.proof', fileText(`${ctx.mount('st1')}/child/pend-proof-p.txt`));
  }
  const ch = await api('op', 'POST', `/v1/agents/sessions/${H}/events`, { type: 'agent.session.cancel', turn_id: state.turnH }, { 'idempotency-key': 'ctl-cancel-H' });
  record('ctl.H.cancel', { status: ch.status, code: ch.code, body: ch.json });
  record('ctl.H.turn', await waitTurn(H, state.turnH, ['CANCELLED', 'FAILED', 'COMPLETED'], 120000));
  await down();
}

// Spring-only restart (the Harness keeps running): accepted approval and cancellation
// across a Java redeploy that turns the Shell opt-in off (flagAfter=false) or keeps it (control).
async function phaseSpringOnly(flagAfter) {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  state.sessions ??= {};
  const tag = flagAfter ? 'sp-on' : 'sp-off';
  const p = await restCreate('op', 'W1', 'PEND::sp pending', randomUUID());
  const P = p.json?.id;
  state.sessions.SP = P; saveState();
  const act = await waitAction(P);
  check(`${tag}: P action requested before restart`, !!act, true);
  const h = await restCreate('op', 'W3', 'HOLD::sh keep running', randomUUID());
  const H = h.json?.id;
  state.sessions.SH = H; saveState();
  await waitTurn(H, null, ['RUNNING'], 60000);
  const turnH = turnsOf(H)[0]?.[0];
  const z = await restCreate('op', 'W2', 'SHELL::sz done', randomUUID());
  const Z = z.json?.id;
  const actZ = await waitAction(Z);
  await respond(Z, actZ, 'allow');
  check(`${tag}: Z completes before restart`, (await waitTurn(Z)).status, 'COMPLETED');
  // Restart Spring only.
  const t0 = Date.now();
  await stop(spring, process.env.RIG_PID_KILL === '1');
  spring = await startSpring(ctx, { QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: flagAfter ? 'true' : null }, 'spring2');
  record(`${tag}.springRestartMs`, Date.now() - t0);
  record(`${tag}.Z.caps`, pickCaps(capsOf(await restGet('op', Z))));
  const fz = await restSubmit('op', Z, 'SHELL::sz2 fresh');
  record(`${tag}.Z.fresh`, `${fz.status} ${fz.code}`);
  if (fz.status === 202) {
    const a2 = await waitAction(Z, 30000);
    if (a2) await respond(Z, a2, 'deny');
    await waitTurn(Z, fz.json?.turn_id);
  }
  const actions = await listActions(P);
  const actP = (actions.json?.data ?? []).find((x) => x.id === act?.id) ?? null;
  check(`${tag}: P action still requested after restart`, actP?.state ?? '(missing)', 'requested');
  if (actP) {
    const r = await respond(P, actP, 'allow');
    check(`${tag}: P allow accepted`, r.status, 202);
    const tP = await waitTurn(P, null, ['COMPLETED', 'FAILED', 'CANCELLED'], 180000);
    record(`${tag}.P.turn`, tP);
    check(`${tag}: P turn completes`, tP.status, 'COMPLETED');
    check(`${tag}: P side effect once`, fileText(`${ctx.mount('st1')}/child/pend-proof-sp.txt`), 'pend\n');
  }
  const ch = await api('op', 'POST', `/v1/agents/sessions/${H}/events`, { type: 'agent.session.cancel', turn_id: turnH }, { 'idempotency-key': `${tag}-cancel` });
  check(`${tag}: H cancel accepted`, ch.status, 202);
  const tH = await waitTurn(H, turnH, ['CANCELLED', 'FAILED', 'COMPLETED'], 120000);
  record(`${tag}.H.turn`, tH);
  check(`${tag}: H cancelled`, tH.status, 'CANCELLED');
  await holdOpen(tag);
  await down();
}

// Files-profile control for restart behavior: files1 creates and runs one tool Turn, files2 restarts and runs another.
async function phaseFiles(second) {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: null });
  seedRegistry();
  state.sessions ??= {};
  let F = state.sessions.F;
  let s;
  if (!second) {
    const c = await restCreate('op', 'W1', 'FILES::f1 write it');
    F = c.json?.id; state.sessions.F = F; saveState();
    check('files1: profile', sessRow(F)?.profile, 'hosted-workspace-files/1');
  } else {
    s = await restSubmit('op', F, 'FILES::f2 after restart');
    check('files2: fresh turn accepted', s.status, 202);
  }
  const act = await waitAction(F, 60000);
  record(`${second ? 'files2' : 'files1'}.action`, !!act);
  if (act) await respond(F, act, 'allow');
  const t = await waitTurn(F, second ? s.json?.turn_id : null, ['COMPLETED', 'FAILED', 'CANCELLED'], 120000);
  check(`${second ? 'files2' : 'files1'}: turn completes`, t.status, 'COMPLETED');
  check(`${second ? 'files2' : 'files1'}: proof`, fileText(`${ctx.mount('st1')}/child/files-proof-${second ? 'f2' : 'f1'}.txt`), `files ${second ? 'f2' : 'f1'}\n`);
  await down();
}

// Harness-only restart: a Shell Session is reloaded by the new Harness (Spring stays up).
// The tool list of the first model request after the reload shows whether suppressChildAgents
// also reaches the load path. CHILD::fg::<id> asks the model to call agent.
async function phaseHarnessRestart() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  state.sessions ??= {};
  const c = await restCreate('op', 'W1', 'CHILD::fg::hr1 before restart');
  const S = c.json?.id;
  state.sessions.HR = S; saveState();
  const t1 = await waitTurn(S, null, ['COMPLETED', 'FAILED', 'CANCELLED'], 120000, async () => {
    const a = await waitAction(S, 400); if (a) await respond(S, a, 'allow');
  });
  record('hr.turn1', t1);
  const t0 = Date.now();
  await stop(harness);
  harness = await startHarness(ctx, fake, 'harness2');
  record('hr.harnessRestartMs', Date.now() - t0);
  const s2 = await restSubmit('op', S, 'CHILD::fg::hr2 after harness restart');
  record('hr.submit2', { status: s2.status, code: s2.code });
  const t2 = await waitTurn(S, s2.json?.turn_id, ['COMPLETED', 'FAILED', 'CANCELLED'], 150000, async () => {
    const a = await waitAction(S, 400); if (a) await respond(S, a, 'allow');
  });
  record('hr.turn2', t2);
  const reqs = modelRequests(fake);
  record('hr.toolsBefore', [...new Set(reqs.filter((r) => r.id === 'hr1').map((r) => r.tools.slice().sort().join(',')))]);
  record('hr.toolsAfter', [...new Set(reqs.filter((r) => r.id === 'hr2').map((r) => r.tools.slice().sort().join(',')))]);
  record('hr.agentResults', reqs.filter((r) => r.id === 'hr1' || r.id === 'hr2').map((r) => ({ id: r.id, step: r.step, last: r.toolResults.slice(-1)[0]?.slice(0, 200) ?? null })));
  record('hr.children', rows(sql(`SELECT COUNT(*) FROM managed_agent_session WHERE ${hasParentColumn() ? 'parent_session_id IS NOT NULL' : '1=0'}`)));
  check('hr: agent absent before restart', (ctx.results['hr.toolsBefore'] ?? []).every((t) => !t.split(',').includes('agent')), true);
  check('hr: agent absent after harness reload', (ctx.results['hr.toolsAfter'] ?? []).every((t) => !t.split(',').includes('agent')) && (ctx.results['hr.toolsAfter'] ?? []).length > 0, true);
  await down();
}

// Non-creator OPERATOR answering a Shell approval in someone else's Session (main #13545 contract).
async function phaseOperatorApproves() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  sql(`INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, 'W1', 'op2', 'OPERATOR')`);
  state.sessions ??= {};
  const c = await restCreate('op', 'W1', 'PEND::oa owned by op');
  const S = c.json?.id;
  state.sessions.OA = S; saveState();
  const act = await waitAction(S);
  record('oa.action', act ? { tool: act.tool_name, preview: act.input_preview?.text } : null);
  const rd = await respond(S, act, 'allow', 'rd');
  record('oa.readerRespond', `${rd.status} ${rd.code}`);
  const listOp2 = await listActions(S, 'op2');
  record('oa.op2ListActions', { status: listOp2.status, n: listOp2.json?.data?.length ?? null });
  const r = await respond(S, act, 'allow', 'op2');
  record('oa.op2Respond', `${r.status} ${r.code}`);
  const t = await waitTurn(S, null, ['COMPLETED', 'FAILED', 'CANCELLED'], 120000);
  record('oa.turn', t);
  record('oa.proof', fileText(`${ctx.mount('st1')}/child/pend-proof-oa.txt`));
  record('oa.decidedBy', rows(sql(`SELECT state, COALESCE(CAST(decided_by AS CHAR), '(n/a)') FROM managed_agent_action WHERE session_id=${q(S)}`)) ?? null);
  await down();
}

async function phaseOn2() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  const { A } = state.sessions;
  check('on2: A foreground_shell true again', capsOf(await restGet('op', A))?.foreground_shell, true);
  const s = await restSubmit('op', A, 'SHELL::a4 flag back on');
  check('on2: fresh turn accepted', s.status, 202);
  const act = await waitAction(A);
  if (act) await respond(A, act, 'allow');
  const t = await waitTurn(A, s.json?.turn_id);
  check('on2: fresh turn completes', t.status, 'COMPLETED');
  check('on2: proof a4 (cwd c2)', fileText(`${ctx.mount('st1')}/c2/shell-proof-a4.txt`) ?? fileText(`${ctx.mount('st1')}/child/shell-proof-a4.txt`), 'once\n');
  await holdOpen('on2');
  await down();
}

async function phaseChild(control = false) {
  // H4b x public Shell: does a public Shell Session reach the agent tool, and what happens to its children?
  // control=true: an arm without the public Shell opt-in (main); a rig-only trigger stamps new
  // Workspace Sessions with the Shell profile, the way #13550's own verification reached H4b.
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', ...(process.env.RIG_DEADLINE ? { QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE: process.env.RIG_DEADLINE } : {}) });
  seedRegistry();
  if (control) {
    sqlRaw('DROP TRIGGER IF EXISTS rig_shell_profile', ctx.db);
    const tr = sqlRaw("CREATE TRIGGER rig_shell_profile BEFORE INSERT ON managed_agent_session FOR EACH ROW SET NEW.tool_profile = IF(NEW.tool_profile = 'hosted-workspace-files/1', 'hosted-workspace-shell/1', NEW.tool_profile)", ctx.db);
    record('controlTrigger', tr);
    if (!tr.ok) throw new Error(`control trigger failed: ${tr.err}`);
  }
  state.sessions ??= {};
  const out = {};
  // Approval mode is default: answer every requested Action (parent agent launches and child calls) with allow.
  let answering = true;
  const answered = new Set();
  const answerLoop = (async () => {
    while (answering) {
      try {
        const sids = rows(sql(`SELECT session_id FROM managed_agent_session WHERE workspace_id IS NOT NULL`)).map((r) => r[0]);
        for (const sid of sids) {
          const r = await listActions(sid);
          for (const a of r.json?.data ?? []) {
            if (a.state !== 'requested' || answered.has(a.id)) continue;
            answered.add(a.id);
            const resp = await respond(sid, a, 'allow');
            log('auto-allow', sid.slice(0, 8), a.tool_name, resp.status);
            (state.autoAllowed ??= []).push({ sid, tool: a.tool_name, status: resp.status });
          }
        }
      } catch (e) { log('answerLoop', String(e)); }
      await sleep(1000);
    }
  })();
  const cases = [['K_fg', 'W4', 'CHILD::fg::kfg delegate'], ['K_bg', 'W5', 'CHILD::bg::kbg delegate'], ['K_fail', 'W3', 'CHILDFAIL::bg::kfail delegate'], ['K_fgfail', 'W2', 'CHILDFAIL::fg::kfgfail delegate']];
  for (const [name, ws, prompt] of cases.filter(([n]) => !process.env.RIG_CASES || process.env.RIG_CASES.split(',').includes(n))) {
    const c = await restCreate('op', ws, prompt);
    const sid = c.json?.id;
    state.sessions[name] = sid; saveState();
    const t = await waitTurn(sid, null, ['COMPLETED', 'FAILED', 'CANCELLED'], Number(process.env.RIG_PARENT_WAIT_MS ?? 150000));
    await sleep(Number(process.env.RIG_SETTLE_MS ?? 20000));
    const kids = rows(sql(`SELECT session_id, status, COALESCE(tool_profile,''), COALESCE(approval_mode,'') FROM managed_agent_session WHERE parent_session_id=${q(sid)}`));
    const relay = rows(sqlRaw(`SELECT state, attempts, COALESCE(last_error,'') FROM qwen_managed_child_result_relay WHERE parent_session_id=${q(sid)}`, ctx.db).out);
    const kidTurns = kids.map((k) => turnsOf(k[0]));
    out[name] = { parentTurn: t, parentTurns: turnsOf(sid), children: kids, childTurns: kidTurns, relay, ops: kids.map((k) => rows(sql(`SELECT operation_kind, state FROM managed_agent_operation WHERE session_id=${q(k[0])}`))) };
    log(name, out[name]);
  }
  await sleep(Number(process.env.RIG_FINAL_WAIT_MS ?? 0));
  out.final = {
    at: new Date().toISOString(),
    relay: rows(sqlRaw(`SELECT r.parent_session_id, r.state, r.attempts, COALESCE(r.last_error,''), FROM_UNIXTIME(r.next_retry_at/1000), COALESCE(r.child_session_id,'') FROM qwen_managed_child_result_relay r ORDER BY r.created_at`, ctx.db).out),
    children: rows(sql(`SELECT parent_session_id, session_id, status, COALESCE(tool_profile,'') FROM managed_agent_session WHERE parent_session_id IS NOT NULL ORDER BY created_at`)),
    childOps: rows(sql(`SELECT o.session_id, o.operation_kind, o.state FROM managed_agent_operation o JOIN managed_agent_session s ON s.tenant_id=o.tenant_id AND s.session_id=o.session_id WHERE s.parent_session_id IS NOT NULL`)),
    parentTurns: Object.fromEntries(cases.map(([n]) => [n, state.sessions[n] ? turnsOf(state.sessions[n]) : null])),
  };
  answering = false;
  await answerLoop;
  out.autoAllowed = state.autoAllowed ?? [];
  const reqs = modelRequests(fake);
  out.toolsParent = [...new Set(reqs.filter((r) => r.kind === 'CHILD' || r.kind === 'CHILDFAIL').map((r) => r.tools.slice().sort().join(',')))];
  out.toolsChild = [...new Set(reqs.filter((r) => r.kind === 'CHILDTEXT' || r.kind === 'CHILDFAILTEXT').map((r) => r.tools.slice().sort().join(',')))];
  record('child', out);
  await holdOpen('child');
  await down();
}

async function phaseRollback() {
  // An older binary (no Shell gate) on a DB that already has Shell Sessions.
  await up({ QWEN_MANAGED_AGENT_APPROVAL_MODE: process.env.RIG_ROLLBACK_APPROVAL ?? 'yolo' });
  const { A } = state.sessions;
  const g = await restGet('op', A);
  record('rollback.A.caps', capsOf(g));
  const s = await restSubmit('op', A, 'SHELL::a5 after rollback');
  record('rollback.A.fresh', { status: s.status, code: s.code });
  let act = null;
  if (s.status === 202) {
    act = await waitAction(A, 30000);
    record('rollback.A.action', act);
    if (act) await respond(A, act, 'allow');
    const t = await waitTurn(A, s.json?.turn_id, ['COMPLETED', 'FAILED', 'CANCELLED'], 90000);
    record('rollback.A.turn', t);
  }
  record('rollback.A.proof', fileText(`${ctx.mount('st1')}/c2/shell-proof-a5.txt`) ?? fileText(`${ctx.mount('st1')}/child/shell-proof-a5.txt`));
  record('rollback.A.allProofs', proofFiles('W1'));
  record('rollback.A.approvalSeen', !!act);
  record('rollback.A.toolsSeen', [...new Set(modelRequests(fake).filter((r) => r.id === 'a5').map((r) => r.tools.slice().sort().join(',')))]);
  await down();
}

try {
  if (phase === 'boot') await phaseBoot();
  else if (phase === 'on') await phaseOn();
  else if (phase === 'off') await phaseOff();
  else if (phase === 'yolo-off') await phaseOff({ QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo' }, 'yolooff');
  else if (phase === 'on2') await phaseOn2();
  else if (phase === 'hrestart') await phaseHarnessRestart();
  else if (phase === 'opapprove') await phaseOperatorApproves();
  else if (phase === 'files1') await phaseFiles(false);
  else if (phase === 'files2') await phaseFiles(true);
  else if (phase === 'restart-on') await phaseRestartOn();
  else if (phase === 'sp-off') await phaseSpringOnly(false);
  else if (phase === 'sp-on') await phaseSpringOnly(true);
  else if (phase === 'child') await phaseChild();
  else if (phase === 'childctl') await phaseChild(true);
  else if (phase === 'rollback') await phaseRollback();
  else throw new Error(`unknown phase ${phase}`);
} catch (e) {
  log('ERROR', e.stack ?? String(e));
  record('error', String(e.stack ?? e));
  process.exitCode = 1;
} finally {
  for (const c of ctx.children) await stop(c);
  const fails = ctx.results.checks.filter((c) => !c.pass).length;
  log(`SUMMARY ${phase} ${arm} ${db}: ${ctx.results.checks.length - fails}/${ctx.results.checks.length} checks pass`);
  process.exit(process.exitCode ?? 0);
}
