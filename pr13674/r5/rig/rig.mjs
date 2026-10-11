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

// Round 3: Shell Action answers admit only the recorded owner (10e20706); files keep the operator arm.
const grantW1 = (a, role) => `INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, 'W1', '${a}', '${role}')`;
const responseOps = (sid) => Number(sql(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id=${q(sid)} AND operation_kind='ACTION_RESPONSE'`));
const actionState = async (sid, id) => { const a = ((await listActions(sid)).json?.data ?? []).find((x) => (x.id ?? x.actionId) === id); return a ? (a.status ?? a.state ?? '(none)') : null; };
async function phaseOwnerOnlyShell() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  sql([grantW1('op2', 'OPERATOR'), grantW1('ow', 'OWNER')].join(';'));
  record('grants.W1', rows(sql(`SELECT CAST(actor_id AS CHAR), role FROM managed_workspace_access WHERE workspace_id='W1' ORDER BY 1`)));
  state.sessions ??= {};
  const c = await restCreate('op', 'W1', 'PEND::s1 owned by op');
  const S = c.json?.id;
  state.sessions.S1 = S; saveState();
  check('S1 REST create by op -> 202', c.status, 202);
  check('S1 profile', sessRow(S)?.profile, 'hosted-workspace-shell/1');
  const act = await waitAction(S);
  state.actionS1 = act; saveState();
  check('S1 Shell action requested', !!act, true);
  const listOp2 = await listActions(S, 'op2');
  check('op2 (OPERATOR) can read the Action', [listOp2.status, (listOp2.json?.data ?? []).length], [200, 1]);
  const ops0 = responseOps(S);
  const tries = [
    ['op2 (OPERATOR) REST allow', 'op2', 'allow', false],
    ['op2 (OPERATOR) WebShell allow', 'op2', 'allow', true],
    ['op2 (OPERATOR) REST deny', 'op2', 'deny', false],
    ['ow (Workspace OWNER, not creator) REST allow', 'ow', 'allow', false],
    ['ow (Workspace OWNER, not creator) WebShell allow', 'ow', 'allow', true],
    ['rd (READER) REST allow', 'rd', 'allow', false],
  ];
  for (const [label, actor, opt, web] of tries) {
    const r = await respond(S, act, opt, actor, web, `${actor}-${opt}-${web ? 'web' : 'rest'}`);
    check(`${label} -> 403 action_forbidden`, `${r.status} ${r.code}`, '403 action_forbidden');
    record(`refusal.${actor}.${opt}.${web ? 'web' : 'rest'}`, r.json?.error?.message ?? r.json?.message ?? null);
  }
  check('refusals record no ACTION_RESPONSE operation', responseOps(S), ops0);
  check('Action still requested after refusals', await actionState(S, act?.id ?? act?.actionId), 'requested');
  check('no command ran yet', fileText(`${ctx.mount('st1')}/child/pend-proof-s1.txt`), null);
  record('webCaps.op', pickCaps(capsOf(await webGet('op', S))));
  record('webCaps.op2', pickCaps(capsOf(await webGet('op2', S))));
  await holdOpen('s1');
  const ok = await respond(S, act, 'allow', 'op', false, 'op-allow-rest');
  check('op (recorded owner) REST allow -> 202', ok.status, 202);
  const t = await waitTurn(S);
  check('S1 Turn completes', t.status, 'COMPLETED');
  check('S1 command ran once', fileText(`${ctx.mount('st1')}/child/pend-proof-s1.txt`), 'pend\n');
  // An OPERATOR may still submit a Turn to the owner's Shell Session; its approval waits for the owner.
  const s2 = await restSubmit('op2', S, 'PEND::s2 submitted by op2');
  check('op2 submits a fresh Turn on op\'s Shell Session -> 202', s2.status, 202);
  if (s2.status === 202) {
    const a2 = await waitAction(S);
    const x = await respond(S, a2, 'allow', 'op2', true, 'op2-own-turn');
    check('op2 cannot approve the Shell call of its own Turn -> 403', `${x.status} ${x.code}`, '403 action_forbidden');
    check('op2-submitted Turn: no command before owner allow', fileText(`${ctx.mount('st1')}/child/pend-proof-s2.txt`), null);
    const y = await respond(S, a2, 'allow', 'op', true, 'op-allow-web');
    check('op (owner) WebShell allow -> 202', y.status, 202);
    const t2 = await waitTurn(S, s2.json?.turn_id);
    check('op2-submitted Turn completes after owner allow', t2.status, 'COMPLETED');
    check('S2 command ran once', fileText(`${ctx.mount('st1')}/child/pend-proof-s2.txt`), 'pend\n');
  }
  record('decisions', rows(sql(`SELECT operation_kind, state, COALESCE(error_code,'') FROM managed_agent_operation WHERE session_id=${q(S)} AND operation_kind='ACTION_RESPONSE' ORDER BY created_at`)));
  const reqs = modelRequests(fake);
  record('toolsAdvertised', [...new Set(reqs.filter((r) => r.id === 's1' || r.id === 's2').map((r) => r.tools.slice().sort().join(',')))]);
  check('Shell tools exclude agent', (ctx.results.toolsAdvertised ?? []).every((x) => !x.split(',').includes('agent')) && (ctx.results.toolsAdvertised ?? []).length > 0, true);
  await down();
}

// Control: a files Session keeps main's operator arm (#13545).
async function phaseOperatorFiles() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: null });
  seedRegistry();
  sql([grantW1('op2', 'OPERATOR'), grantW1('ow', 'OWNER')].join(';'));
  state.sessions ??= {};
  const c = await restCreate('op', 'W1', 'FILES::of1 write it');
  const F = c.json?.id;
  state.sessions.OF = F; saveState();
  check('OF REST create -> 202', c.status, 202);
  check('OF profile', sessRow(F)?.profile, 'hosted-workspace-files/1');
  const act = await waitAction(F);
  check('OF files action requested', !!act, true);
  const rd = await respond(F, act, 'allow', 'rd', false, 'rd-allow');
  check('rd (READER) allow -> 403', `${rd.status} ${rd.code}`, '403 action_forbidden');
  const r = await respond(F, act, 'allow', 'op2', true, 'op2-allow-web');
  check('op2 (OPERATOR) WebShell allow on files Session -> 202', r.status, 202);
  const t = await waitTurn(F);
  check('OF Turn completes', t.status, 'COMPLETED');
  check('OF file written', fileText(`${ctx.mount('st1')}/child/files-proof-of1.txt`), 'files of1\n');
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

// ---------- Round 4 (head 4b2bb453) ----------
const IS_MAIN = arm === 'mn5';
const ALLOW_PROFILES = 'hosted-workspace-files/1,hosted-workspace-shell/1,hosted-workspace-team-lead/1';
const tenantCounts = () => {
  const r = rows(sql(`SELECT (SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id=${q(T)}), (SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id=${q(T)}), (SELECT COUNT(*) FROM managed_workspace_create_command WHERE tenant_id=${q(T)})`))[0];
  return { sessions: +r[0], turns: +r[1], createCmds: +r[2] };
};
const defineAgent = (profile, approval) => api('op', 'POST', '/v1/agents', { model: {}, instructions: 'rig definition', tools: [{ type: 'hosted_profile', profile }], permission_policy: approval ? { approval_mode: approval } : {}, metadata: { rig: profile } }, { 'idempotency-key': randomUUID() });
const restCreateAs = (actor, agentId, ws, input, key = randomUUID(), cwd = 'child', extra = {}) =>
  api(actor, 'POST', '/v1/agents/sessions', { agent_id: agentId, workspace: { workspace_id: ws, cwd_relative: cwd }, ...(input ? { input: [{ type: 'input_text', text: input }] } : {}), metadata: { title: `rig ${input ?? 'empty'}` }, ...extra }, { 'idempotency-key': key });
const webCreateAs = (actor, agentId, ws, input, key = randomUUID(), cwd = 'child') =>
  api(actor, 'POST', '/api/agent/web-shell/v1/sessions/create', { idempotencyKey: key, agentId, title: `rig web ${input ?? 'empty'}`, input: input ? [{ type: 'input_text', text: input }] : [], workspace: { workspaceId: ws, cwdRelative: cwd } });
const toolsFor = (...ids) => [...new Set(modelRequests(fake).filter((r) => ids.includes(r.id)).map((r) => r.tools.slice().sort().join(',')))];
const lastResultsFor = (id) => modelRequests(fake).filter((r) => r.id === id).map((r) => ({ step: r.step, last: r.toolResults.slice(-1)[0]?.slice(0, 240) ?? null }));
const hasTool = (sets, name) => sets.some((t) => t.split(',').includes(name));
const anyTeamTool = (sets) => sets.some((t) => t.split(',').some((n) => /^team_|^task_/.test(n)));
const modelHits = (id) => modelRequests(fake).filter((r) => r.id === id).length;
// An undeclared tool call fails the whole Turn closed ("Hosted Workspace profile refused a tool call."), as in round 3.
const refusedClosed = (t) => t?.status === 'FAILED' && t?.error === 'hosted_turn_failed';
const harnessRefusals = () => fs.readdirSync(ctx.runDir).filter((f) => /^harness.*\.log$/.test(f)).map((f) => (fs.readFileSync(`${ctx.runDir}/${f}`, 'utf8').match(/Hosted Workspace profile refused a tool call/g) ?? []).length).reduce((a, b) => a + b, 0);
const childRows = () => Number(sql(`SELECT COUNT(*) FROM managed_agent_session WHERE ${hasParentColumn() ? 'parent_session_id IS NOT NULL' : '1=0'}`));
async function driveTurn(sid, turnId, approver = 'op', timeoutMs = 150000) {
  return waitTurn(sid, turnId, ['COMPLETED', 'FAILED', 'CANCELLED'], timeoutMs, async () => {
    const a = await waitAction(sid, 400); if (a) await respond(sid, a, 'allow', approver);
  });
}

async function phaseDefs() {
  const shellOn = process.env.RIG_SHELL === 'on';
  const tag = IS_MAIN ? 'main' : shellOn ? 'on' : 'off';
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: shellOn ? 'true' : null, QWEN_MANAGED_AGENT_DEFINITION_TOOL_PROFILES: ALLOW_PROFILES });
  seedRegistry();
  sql(grantW1('op2', 'OPERATOR'));
  state.sessions ??= {};
  const dS = await defineAgent('hosted-workspace-shell/1', 'default');
  const dF = await defineAgent('hosted-workspace-files/1', 'default');
  const dT = await defineAgent('hosted-workspace-team-lead/1', 'yolo');
  const dTa = await defineAgent('hosted-workspace-team-lead/1', 'default');
  record('definitions', { shell: [dS.status, dS.json?.id ?? dS.text.slice(0, 200)], files: [dF.status, dF.json?.id], teamLeadYolo: [dT.status, dT.json?.id], teamLeadDefault: [dTa.status, dTa.json?.id] });
  check(`${tag}: definitions stored`, [dS.status, dF.status, dT.status, dTa.status], [202, 202, 202, 202]);
  const DS = dS.json?.id, DF = dF.json?.id, DT = dT.json?.id, DTA = dTa.json?.id;

  // A: Shell definition + initial input (REST, then WebShell).
  let c0 = tenantCounts();
  const a = await restCreateAs('op', DS, 'W1', 'PEND::d1 shell definition with input');
  const aw = await webCreateAs('op', DS, 'W2', 'PEND::d2 shell definition with input (web)');
  record(`${tag}.A`, { rest: `${a.status} ${a.code}`, web: `${aw.status} ${aw.code}`, countsBefore: c0, countsAfter: tenantCounts() });
  if (!IS_MAIN && !shellOn) {
    check('off: Shell definition + input, REST -> 409 workspace_unavailable', `${a.status} ${a.code}`, '409 workspace_unavailable');
    check('off: Shell definition + input, WebShell -> 409 workspace_unavailable', `${aw.status} ${aw.code}`, '409 workspace_unavailable');
    check('off: refusals leave no Session/Turn/create-command rows', tenantCounts(), c0);
    check('off: no model request for d1/d2', modelHits('d1') + modelHits('d2'), 0);
  } else {
    check(`${tag}: Shell definition + input, REST -> 202`, a.status, 202);
    const A = a.json?.id; state.sessions.DA = A; saveState();
    const row = sessRow(A);
    record(`${tag}.A.row`, row);
    check(`${tag}: A pinned profile/approval`, [row?.profile, row?.approval], ['hosted-workspace-shell/1', 'default']);
    const act = await waitAction(A);
    check(`${tag}: A Shell action requested`, !!act, true);
    const r2 = await respond(A, act, 'allow', 'op2', false, 'op2-allow-d1');
    record(`${tag}.A.op2Respond`, `${r2.status} ${r2.code}`);
    if (!IS_MAIN) check('on: op2 (OPERATOR) cannot answer a definition Shell Action -> 403', `${r2.status} ${r2.code}`, '403 action_forbidden');
    else check('main: op2 (OPERATOR) answers a definition Shell Action -> 202', r2.status, 202);
    if (r2.status !== 202) await respond(A, act, 'allow', 'op', false, 'op-allow-d1');
    const t = await waitTurn(A);
    check(`${tag}: A completes`, t.status, 'COMPLETED');
    check(`${tag}: A command ran once`, fileText(`${ctx.mount('st1')}/child/pend-proof-d1.txt`), 'pend\n');
    const W = aw.json?.sessionId;
    if (W) { const tw = await driveTurn(W, null); record(`${tag}.AW.turn`, tw); }
  }

  // B: Shell definition, empty creation, then a fresh Turn; replay of the creation key.
  const kB = randomUUID();
  const b = await restCreateAs('op', DS, 'W3', null, kB);
  check(`${tag}: Shell definition empty creation -> 202`, b.status, 202);
  const B = b.json?.id; state.sessions.DB = B; saveState();
  const rowB = sessRow(B);
  record(`${tag}.B.row`, rowB);
  check(`${tag}: B pinned profile`, rowB?.profile, 'hosted-workspace-shell/1');
  const capsB = capsOf(await restGet('op', B));
  const webCapsB = capsOf(await webGet('op', B));
  record(`${tag}.B.caps`, { rest: pickCaps(capsB), web: pickCaps(webCapsB) });
  check(`${tag}: B foreground_shell (REST)`, capsB?.foreground_shell ?? '(absent)', IS_MAIN ? '(absent)' : shellOn);
  const b2 = await restCreateAs('op', DS, 'W3', null, kB);
  check(`${tag}: B creation replay -> same Session`, [b2.status, b2.json?.id === B], [b.status, true]);
  const c1 = tenantCounts();
  const sB = await restSubmit('op', B, 'PEND::d3 fresh turn on a definition Shell Session');
  record(`${tag}.B.submit`, `${sB.status} ${sB.code}`);
  if (!IS_MAIN && !shellOn) {
    check('off: fresh Turn on definition Shell Session -> 409 workspace_unavailable', `${sB.status} ${sB.code}`, '409 workspace_unavailable');
    check('off: fresh-Turn refusal adds no Turn', tenantCounts().turns, c1.turns);
  } else {
    check(`${tag}: fresh Turn on definition Shell Session -> 202`, sB.status, 202);
    const t = await driveTurn(B, sB.json?.turn_id);
    check(`${tag}: B Turn completes`, t.status, 'COMPLETED');
    if (!IS_MAIN) {
      const m = await restSubmit('op', B, 'MSG::d6 try to message a child');
      const tm = await driveTurn(B, m.json?.turn_id);
      record(`${tag}.B.msgTurn`, { submit: m.status, turn: tm, results: lastResultsFor('d6') });
      check('on: send_message call on public Shell fails the Turn closed', [refusedClosed(tm), modelHits('d6'), harnessRefusals() >= 1], [true, 1, true]);
    }
  }

  // C: files definition keeps files/1 even with the Shell flag on.
  const f = await restCreateAs('op', DF, 'W4', 'FILES::d4 files definition');
  check(`${tag}: files definition + input -> 202`, f.status, 202);
  const F = f.json?.id; state.sessions.DF = F; saveState();
  check(`${tag}: files definition keeps files/1`, sessRow(F)?.profile, 'hosted-workspace-files/1');
  check(`${tag}: files definition caps omit foreground_shell`, 'foreground_shell' in (capsOf(await restGet('op', F)) ?? {}), false);
  const tf = await driveTurn(F, null);
  check(`${tag}: files definition Turn completes`, tf.status, 'COMPLETED');

  // D: the reserved internal profile through a definition, even though the allowlist names it.
  const c2 = tenantCounts();
  const tries = [
    ['REST + input, yolo', () => restCreateAs('op', DT, 'W5', 'SHELL::d7 reserved profile')],
    ['REST empty, yolo', () => restCreateAs('op', DT, 'W5', null)],
    ['WebShell + input, default', () => webCreateAs('op', DTA, 'W5', 'SHELL::d8 reserved profile')],
    ['REST empty, default', () => restCreateAs('op', DTA, 'W5', null)],
  ];
  const outD = {};
  for (const [label, fn] of tries) {
    const r = await fn();
    outD[label] = { status: r.status, code: r.code, field: r.json?.error?.details?.field ?? r.json?.details?.field ?? null, id: r.json?.id ?? r.json?.sessionId ?? null };
    if (!IS_MAIN) check(`${tag}: team-lead definition (${label}) -> 409 agent_definition_unsupported`, `${r.status} ${r.code}`, '409 agent_definition_unsupported');
  }
  record(`${tag}.D`, outD);
  if (!IS_MAIN) check(`${tag}: reserved-profile refusals leave no rows`, tenantCounts(), c2);
  else {
    const ids = Object.values(outD).map((x) => x.id).filter(Boolean);
    record('main.D.rows', ids.map((id) => ({ id, row: sessRow(id), turns: turnsOf(id) })));
    await sleep(8000);
    record('main.D.turnsLater', ids.map((id) => turnsOf(id)));
  }
  record(`${tag}.tools`, { d1: toolsFor('d1'), d3: toolsFor('d3'), d4: toolsFor('d4'), d6: toolsFor('d6') });
  const shellSets = toolsFor('d1', 'd3', 'd6');
  if (!IS_MAIN && shellOn) {
    check('on: definition Shell tools exclude agent', shellSets.length > 0 && !hasTool(shellSets, 'agent'), true);
    check('on: definition Shell tools exclude send_message', !hasTool(shellSets, 'send_message'), true);
    check('on: definition Shell tools exclude team tools', !anyTeamTool(shellSets), true);
  }
  if (IS_MAIN) record('main.shellDefinitionHasAgent', hasTool(shellSets, 'agent'));
  await down();
}

// Public replay must not resolve to a record that carries the reserved internal profile.
async function phaseReplayKind() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  state.sessions ??= {};
  const tag = IS_MAIN ? 'main' : 'head';
  const kR = randomUUID();
  const r1 = await restCreate('op', 'W1', null, kR);
  const S = r1.json?.id; state.sessions.RK = S; saveState();
  const r1b = await restCreate('op', 'W1', null, kR);
  check(`${tag}: REST replay before conversion -> same Session`, [r1b.status, r1b.json?.id === S], [r1.status, true]);
  const kW = randomUUID();
  const w1 = await webCreate('op', 'W2', null, kW);
  const SW = w1.json?.sessionId; state.sessions.RKW = SW; saveState();
  // Simulate a record minted by the trusted internal entry under these keys.
  sql(`UPDATE managed_agent_session SET tool_profile='hosted-workspace-team-lead/1' WHERE session_id IN (${q(S)}, ${q(SW)})`);
  const c0 = tenantCounts();
  const r2 = await restCreate('op', 'W1', null, kR);
  const w2 = await webCreate('op', 'W2', null, kW);
  record(`${tag}.replay`, { rest: { status: r2.status, code: r2.code, sameId: r2.json?.id === S }, web: { status: w2.status, code: w2.code, sameId: w2.json?.sessionId === SW } });
  if (!IS_MAIN) {
    check('head: public REST replay onto an internal record -> 409 idempotency_conflict', `${r2.status} ${r2.code}`, '409 idempotency_conflict');
    check('head: WebShell replay onto an internal record -> 409 idempotency_conflict', `${w2.status} ${w2.code}`, '409 idempotency_conflict');
  } else {
    check('main: public REST replay returns the record', [r2.status, r2.json?.id === S], [r1.status, true]);
    check('main: WebShell replay returns the record', [w2.status, w2.json?.sessionId === SW], [w1.status, true]);
  }
  check(`${tag}: replays add no rows`, tenantCounts(), c0);
  await down();
}

// Control: a record with the reserved profile keeps its private policy with the public Shell flag off.
async function phaseInternal() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: null });
  seedRegistry();
  sql(grantW1('op2', 'OPERATOR'));
  state.sessions ??= {};
  // A public body cannot pick the profile (no such field); extra members are ignored or refused.
  const x = await restCreateAs('op', 'qwen-code', 'W2', null, randomUUID(), 'child', { tool_profile: 'hosted-workspace-team-lead/1', toolProfile: 'hosted-workspace-team-lead/1' });
  record('internal.publicSelector', { status: x.status, code: x.code, profile: x.json?.id ? sessRow(x.json.id)?.profile : null });
  check('public create with a profile member does not mint the reserved profile', x.json?.id ? sessRow(x.json.id)?.profile !== 'hosted-workspace-team-lead/1' : true, true);
  const c = await restCreate('op', 'W1', null);
  const S = c.json?.id; state.sessions.TL = S; saveState();
  sql(`UPDATE managed_agent_session SET tool_profile='hosted-workspace-team-lead/1', approval_mode='default' WHERE session_id=${q(S)}`);
  const caps = capsOf(await restGet('op', S));
  record('internal.caps', pickCaps(caps));
  check('internal: no foreground_shell member', 'foreground_shell' in (caps ?? {}), false);
  const s1 = await restSubmit('op', S, 'PEND::tl1 internal lane with the public flag off');
  check('internal: fresh Turn with the public Shell flag off -> 202', s1.status, 202);
  const act = await waitAction(S);
  check('internal: Shell action requested (default approval)', !!act, true);
  const r = await respond(S, act, 'allow', 'op2', true, 'op2-allow-tl1');
  check('internal: op2 (OPERATOR) may answer (private rule) -> 202', r.status, 202);
  const t = await waitTurn(S, s1.json?.turn_id);
  check('internal: Turn completes', t.status, 'COMPLETED');
  check('internal: command ran once', fileText(`${ctx.mount('st1')}/child/pend-proof-tl1.txt`), 'pend\n');
  const tl = toolsFor('tl1');
  record('internal.tools', tl);
  check('internal: tools include agent', hasTool(tl, 'agent'), true);
  record('internal.toolsHaveTeam', anyTeamTool(tl));
  record('internal.toolsHaveSendMessage', hasTool(tl, 'send_message'));
  // Close follows the same private gate as a files Session on this host (no durable local-process close on macOS).
  const fc = await restCreate('op', 'W3', null);
  const fCaps = capsOf(await restGet('op', fc.json?.id));
  const fcl = await api('op', 'POST', `/v1/agents/sessions/${fc.json?.id}/close`, null, { 'idempotency-key': randomUUID() });
  const cl = await api('op', 'POST', `/v1/agents/sessions/${S}/close`, null, { 'idempotency-key': randomUUID() });
  record('internal.close', { internal: `${cl.status} ${cl.code}`, internalCap: caps?.session_close, filesControl: `${fcl.status} ${fcl.code}`, filesCap: fCaps?.session_close });
  check('internal: close follows the files-Session gate on this host', [`${cl.status} ${cl.code}`, caps?.session_close], [`${fcl.status} ${fcl.code}`, fCaps?.session_close]);
  await down();
}

// cwd change and rename paths (main #13760/#13682) still carry the Shell suppression; tampered approval refused.
async function waitOperation(sid, opId, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs; let last;
  while (Date.now() < end) {
    last = await api('op', 'GET', `/v1/agents/sessions/${sid}/operations/${opId}`);
    const st = last.json?.status;
    if (['completed', 'failed'].includes(st)) return last.json;
    await sleep(500);
  }
  return last?.json ?? null;
}
async function phaseCwdRename() {
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true' });
  seedRegistry();
  state.sessions ??= {};
  // Rename first: the Harness Session is created by the rename path.
  const w = await webCreate('op', 'W1', null);
  const S = w.json?.sessionId; state.sessions.RN = S; saveState();
  check('rn: profile', sessRow(S)?.profile, 'hosted-workspace-shell/1');
  const rn1 = await api('op', 'PATCH', `/v1/agents/sessions/${S}`, { title: 'rig renamed before any turn' }, { 'idempotency-key': randomUUID() });
  check('rn: rename before any Turn -> 200', rn1.status, 200);
  const s1 = await restSubmit('op', S, 'CHILD::fg::rn1 after rename');
  const t1 = await driveTurn(S, s1.json?.turn_id);
  const s2 = await restSubmit('op', S, 'MSG::rn2 message after rename');
  const t2 = await driveTurn(S, s2.json?.turn_id);
  record('rn.turns', { rn1: t1, rn2: t2, results: { rn1: lastResultsFor('rn1'), rn2: lastResultsFor('rn2') } });
  check('rn: agent call after rename fails the Turn closed, no child', [refusedClosed(t1), childRows()], [true, 0]);
  check('rn: send_message call after rename fails the Turn closed', refusedClosed(t2), true);
  const pOk = await restSubmit('op', S, 'PEND::rn4 plain Shell after rename');
  const tOk = await driveTurn(S, pOk.json?.turn_id);
  check('rn: plain Shell call after rename completes', [tOk.status, fileText(`${ctx.mount('st1')}/child/pend-proof-rn4.txt`)], ['COMPLETED', 'pend\n']);
  // Harness restart; the first contact after it is a rename (cold load through the rename path).
  await stop(harness);
  harness = await startHarness(ctx, fake, 'harness2');
  // The first call after a Harness restart adopts the new generation and answers 503 (main behaviour); retry the rename.
  const renames = [];
  let rn2;
  for (let i = 0; i < 4; i++) {
    rn2 = await api('op', 'PATCH', `/v1/agents/sessions/${S}`, { title: 'rig renamed after harness restart' }, { 'idempotency-key': `rn-after-restart-${i}` });
    renames.push(`${rn2.status} ${rn2.code}`);
    if (rn2.status === 200) break;
    await sleep(1500);
  }
  record('rn.renameAfterRestart', renames);
  check('rn: rename after Harness restart (retried past the generation 503) -> 200', rn2.status, 200);
  record('rn.modelRequestsBeforeRn3', modelRequests(fake).length);
  const s3 = await restSubmit('op', S, 'CHILD::fg::rn3 after restart + rename');
  const t3 = await driveTurn(S, s3.json?.turn_id);
  check('rn: agent call after Harness restart + rename fails closed, no child', [refusedClosed(t3), childRows()], [true, 0]);
  record('rn.harnessRefusals', harnessRefusals());
  const rnTools = toolsFor('rn1', 'rn2', 'rn3', 'rn4');
  record('rn.tools', { rn1: toolsFor('rn1'), rn2: toolsFor('rn2'), rn3: toolsFor('rn3'), rn4: toolsFor('rn4') });
  check('rn: tools exclude agent / send_message / team (rename, restart+rename)', [rnTools.length > 0, hasTool(rnTools, 'agent'), hasTool(rnTools, 'send_message'), anyTeamTool(rnTools)], [true, false, false, false]);
  // cwd change before the first Turn, then a Shell call in the new directory.
  const c = await restCreate('op', 'W2', null);
  const C = c.json?.id; state.sessions.CW = C; saveState();
  const g = await restGet('op', C);
  const rev = g.json?.workspace?.context_revision ?? 1;
  record('cw.before', { caps: pickCaps(capsOf(g)), cwdChange: capsOf(await webGet('op', C))?.cwdChange, rev, cwd: g.json?.workspace?.cwd_relative });
  const ch = await api('op', 'POST', `/v1/agents/sessions/${C}/cwd`, { cwd_relative: 'c2', expected_context_revision: rev }, { 'idempotency-key': randomUUID() });
  record('cw.admit', { status: ch.status, code: ch.code, body: ch.json });
  check('cw: cwd change admitted -> 202', ch.status, 202);
  const op = ch.json?.id ? await waitOperation(C, ch.json.id) : null;
  record('cw.operation', op);
  check('cw: cwd change completes', op?.status, 'completed');
  const s4 = await restSubmit('op', C, 'PEND::cw1 after cwd change');
  record('cw.submit', `${s4.status} ${s4.code}`);
  const t4 = await driveTurn(C, s4.json?.turn_id);
  check('cw: Turn after cwd change completes', t4.status, 'COMPLETED');
  check('cw: command ran in the new directory', [fileText(`${ctx.mount('st2')}/c2/pend-proof-cw1.txt`), fileText(`${ctx.mount('st2')}/child/pend-proof-cw1.txt`)], ['pend\n', null]);
  record('cw.pwd', lastResultsFor('cw1'));
  const cwTools = toolsFor('cw1');
  record('cw.tools', cwTools);
  check('cw: tools exclude agent / send_message / team', [cwTools.length > 0, hasTool(cwTools, 'agent'), hasTool(cwTools, 'send_message'), anyTeamTool(cwTools)], [true, false, false, false]);
  // Tampered persisted approval on a Shell Session with a cached attachment: no Harness work.
  sql(`UPDATE managed_agent_session SET approval_mode='yolo' WHERE session_id=${q(C)}`);
  const hits0 = modelRequests(fake).length;
  const s5 = await restSubmit('op', C, 'PEND::tp1 after approval tamper');
  record('tp.submit', { status: s5.status, code: s5.code });
  const t5 = s5.status === 202 ? await waitTurn(C, s5.json?.turn_id, ['COMPLETED', 'FAILED', 'CANCELLED'], 60000) : null;
  record('tp.turn', t5);
  await sleep(3000);
  check('tp: tampered approval -> no model request', modelHits('tp1'), 0);
  check('tp: tampered approval -> no command', fileText(`${ctx.mount('st2')}/c2/pend-proof-tp1.txt`), null);
  record('tp.modelRequestsDelta', modelRequests(fake).length - hits0);
  check('tp: Turn does not complete', t5?.status === 'COMPLETED', false);
  await down();
}

// Rename right after a Harness-only restart: PR head vs main, files vs Shell.
async function phaseRenameProbe() {
  const shellOn = process.env.RIG_SHELL === 'on';
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: shellOn ? 'true' : null });
  seedRegistry();
  const w = await webCreate('op', 'W1', null);
  const S = w.json?.sessionId;
  record('rp.profile', sessRow(S)?.profile);
  const r0 = await api('op', 'PATCH', `/v1/agents/sessions/${S}`, { title: 'rp before' }, { 'idempotency-key': 'rp-0' });
  record('rp.renameBefore', `${r0.status} ${r0.code}`);
  const s1 = await restSubmit('op', S, shellOn ? 'PEND::rp1 before restart' : 'FILES::rp1 before restart');
  record('rp.turn1', await driveTurn(S, s1.json?.turn_id));
  await stop(harness);
  harness = await startHarness(ctx, fake, 'harness2');
  const t0 = Date.now();
  const tries = [];
  for (let i = 0; i < 12; i++) {
    const r = await api('op', 'PATCH', `/v1/agents/sessions/${S}`, { title: `rp after ${i}` }, { 'idempotency-key': `rp-after-${i}` });
    tries.push({ ms: Date.now() - t0, status: r.status, code: r.code, message: r.json?.error?.message ?? r.json?.message ?? r.text.slice(0, 160) });
    if (r.status === 200) break;
    await sleep(2500);
  }
  record('rp.renameAfterRestart', tries);
  const s2 = await restSubmit('op', S, shellOn ? 'PEND::rp2 after restart' : 'FILES::rp2 after restart');
  record('rp.turn2', await driveTurn(S, s2.json?.turn_id));
  const r3 = await api('op', 'PATCH', `/v1/agents/sessions/${S}`, { title: 'rp after turn' }, { 'idempotency-key': 'rp-after-turn' });
  record('rp.renameAfterTurn', { status: r3.status, code: r3.code, message: r3.json?.error?.message ?? null });
  record('rp.titleRow', rows(sql(`SELECT COALESCE(title,'') FROM managed_agent_session WHERE session_id=${q(S)}`)));
  check('rp: rename eventually 200 after restart', tries.some((t) => t.status === 200) || r3.status === 200, true);
  await down();
}

// ---------- Round 5: R3-1, a mixed-case deployment approval mode end to end ----------
// Startup validation lower-cases the configured mode; the question is whether every
// later Shell path (create, Action answer, later Turn, WebShell, Harness cold load,
// rename, cwd change, definitions) still works when the operator writes "Default".
async function phaseCaseMode() {
  const mode = process.env.RIG_APPROVAL_MODE ?? 'Default';
  const want = mode.toLowerCase();
  const tag = `cm[${mode}]`;
  await up({ QWEN_MANAGED_AGENT_WORKSPACE_SHELL_ENABLED: 'true', QWEN_MANAGED_AGENT_APPROVAL_MODE: mode, QWEN_MANAGED_AGENT_DEFINITION_TOOL_PROFILES: ALLOW_PROFILES });
  record('cm.configuredMode', mode);
  check(`${tag}: Spring starts with the mixed-case mode`, true, true);
  seedRegistry();
  sql(grantW1('op2', 'OPERATOR'));
  state.sessions ??= {};
  // 1. REST create with Shell input: create path, first Turn, owner-only answer.
  const a = await restCreate('op', 'W1', 'PEND::cm1 first Turn');
  const A = a.json?.id; state.sessions.CM_A = A; saveState();
  check(`${tag}: REST create with Shell input -> 202`, a.status, 202);
  const rowA = sessRow(A);
  record('cm.rowA', rowA);
  check(`${tag}: persisted profile / approval mode (lower-cased)`, [rowA?.profile, rowA?.approval], ['hosted-workspace-shell/1', want]);
  const act = await waitAction(A);
  check(`${tag}: Shell Action requested`, !!act, true);
  const x = await respond(A, act, 'allow', 'op2');
  check(`${tag}: op2 (OPERATOR) answer -> 403`, `${x.status} ${x.code}`, '403 action_forbidden');
  const ok = await respond(A, act, 'allow');
  check(`${tag}: owner allow -> 202`, ok.status, 202);
  const t1 = await waitTurn(A);
  check(`${tag}: first Turn completes, command ran once`, [t1.status, fileText(`${ctx.mount('st1')}/child/pend-proof-cm1.txt`)], ['COMPLETED', 'pend\n']);
  // 2. Later Turn on the cached attachment.
  const s2 = await restSubmit('op', A, 'PEND::cm2 later Turn');
  const t2 = await driveTurn(A, s2.json?.turn_id);
  check(`${tag}: later Turn completes`, [s2.status, t2.status, fileText(`${ctx.mount('st1')}/child/pend-proof-cm2.txt`)], [202, 'COMPLETED', 'pend\n']);
  // 3. WebShell empty create + submit.
  const w = await webCreate('op', 'W2', null);
  const B = w.json?.sessionId; state.sessions.CM_B = B; saveState();
  const capB = capsOf(await webGet('op', B));
  check(`${tag}: WebShell create, foregroundShell`, [w.status, capB?.foregroundShell ?? '(absent)'], [202, true]);
  const s3 = await webSubmit('op', B, 'PEND::cm3 WebShell Turn');
  const t3 = await driveTurn(B, s3.json?.turnId);
  check(`${tag}: WebShell Turn completes`, [s3.status, t3.status, fileText(`${ctx.mount('st2')}/child/pend-proof-cm3.txt`)], [202, 'COMPLETED', 'pend\n']);
  // 4. Harness restart: the next contacts cold-load the Session (rename, then a Turn).
  await stop(harness);
  harness = await startHarness(ctx, fake, 'harness2');
  const renames = [];
  let rn;
  for (let i = 0; i < 12; i++) {
    rn = await api('op', 'PATCH', `/v1/agents/sessions/${A}`, { title: 'rig renamed after harness restart' }, { 'idempotency-key': `cm-rn-${i}` });
    renames.push(`${rn.status} ${rn.code}`);
    if (rn.status === 200) break;
    await sleep(1500);
  }
  record('cm.renameAfterRestart', renames);
  check(`${tag}: rename after Harness restart -> 200 (503 retries are main's restart window)`, rn.status, 200);
  const s4 = await restSubmit('op', A, 'PEND::cm4 after Harness restart');
  const t4 = await driveTurn(A, s4.json?.turn_id);
  check(`${tag}: Turn after Harness restart completes`, [s4.status, t4.status, fileText(`${ctx.mount('st1')}/child/pend-proof-cm4.txt`)], [202, 'COMPLETED', 'pend\n']);
  // 5. cwd change on the WebShell Session, then a Turn in the new directory.
  const g = await restGet('op', B);
  const rev = g.json?.workspace?.context_revision ?? 1;
  const ch = await api('op', 'POST', `/v1/agents/sessions/${B}/cwd`, { cwd_relative: 'c2', expected_context_revision: rev }, { 'idempotency-key': randomUUID() });
  const op = ch.json?.id ? await waitOperation(B, ch.json.id) : null;
  check(`${tag}: cwd change admitted and completes`, [ch.status, op?.status], [202, 'completed']);
  const s5 = await restSubmit('op', B, 'PEND::cm5 after cwd change');
  const t5 = await driveTurn(B, s5.json?.turn_id);
  check(`${tag}: Turn after cwd change completes in the new directory`, [t5.status, fileText(`${ctx.mount('st2')}/c2/pend-proof-cm5.txt`)], ['COMPLETED', 'pend\n']);
  // 6. Definitions: the definition's own approval_mode is matched exactly (unchanged by the PR).
  const dMixed = await defineAgent('hosted-workspace-shell/1', mode);
  const dLower = await defineAgent('hosted-workspace-shell/1', want);
  const dNone = await defineAgent('hosted-workspace-shell/1', null);
  record('cm.definitions', { mixed: [dMixed.status, dMixed.code, dMixed.json?.error?.field ?? null], lower: [dLower.status, dLower.json?.id ?? null], none: [dNone.status, dNone.json?.id ?? null] });
  if (mode !== want) {
    const c0 = tenantCounts();
    const dm = await restCreateAs('op', dMixed.json?.id, 'W1', 'PEND::cm7 definition with a mixed-case mode');
    record('cm.mixedDefinitionCreate', { status: dm.status, code: dm.code, field: dm.json?.error?.field ?? null });
    check(`${tag}: Session from a definition whose own mode is "${mode}" -> 409 agent_definition_unsupported (permission_policy), no rows`, [dm.status, dm.code, dm.json?.error?.field ?? null, tenantCounts().sessions - c0.sessions, modelHits('cm7')], [409, 'agent_definition_unsupported', 'permission_policy', 0, 0]);
  }
  const d = await restCreateAs('op', dNone.json?.id, 'W1', 'PEND::cm6 definition without its own mode');
  const D = d.json?.id;
  const rowD = sessRow(D);
  record('cm.rowD', rowD);
  check(`${tag}: definition without a mode inherits the lower-cased deployment mode`, [d.status, rowD?.profile, rowD?.approval], [202, 'hosted-workspace-shell/1', want]);
  const t6 = await driveTurn(D, null);
  check(`${tag}: definition Session Turn completes`, [t6.status, fileText(`${ctx.mount('st1')}/child/pend-proof-cm6.txt`)], ['COMPLETED', 'pend\n']);
  // 8. R4-2: the Harness reads suppressChildAgents from the load request body. A load with no
  // body, or with {}, must be refused before any Shell lane (and its child orchestrator) is built.
  // The protocol gate answers 426 without the version header but always names the boot id.
  const gate = await fetch(`http://127.0.0.1:${ctx.harnessPort}/session/${A}/load`, { method: 'POST', headers: { authorization: `Bearer ${ctx.state.harnessToken}` } });
  const bootId = gate.headers.get('x-qwen-harness-boot-id');
  record('cm.harnessGate', { status: gate.status, bootId });
  check(`${tag}: Harness boot id read from the protocol gate`, [gate.status, /^[0-9a-f-]{36}$/.test(bootId ?? '')], [426, true]);
  const hz = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${ctx.harnessPort}${path}`, { method: 'POST', headers: { authorization: `Bearer ${ctx.state.harnessToken}`, 'X-Qwen-Harness-Protocol-Version': '1', 'X-Qwen-Harness-Boot-Id': bootId ?? '', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let code = null; try { code = JSON.parse(text).code ?? null; } catch {}
    return { status: r.status, code, body: text.slice(0, 240) };
  };
  const probes = { residentNoBody: await hz(`/session/${A}/load`), residentEmptyObject: await hz(`/session/${A}/load`, {}), unknownNoBody: await hz(`/session/${randomUUID()}/load`) };
  record('cm.harnessBodylessLoads', probes);
  check(`${tag}: direct Harness load (protocol headers, no body / {}) -> 400 invalid_managed_session_store (resident and unknown Session)`, Object.values(probes).map((x) => `${x.status} ${x.code}`), ['400 invalid_managed_session_store', '400 invalid_managed_session_store', '400 invalid_managed_session_store']);
  const s8 = await restSubmit('op', A, 'PEND::cm8 after the bodyless load probes');
  const t8 = await driveTurn(A, s8.json?.turn_id);
  check(`${tag}: Turn after the bodyless load probes completes with the 5 Shell tools`, [t8.status, toolsFor('cm8')], ['COMPLETED', ['edit,monitor,read_file,run_shell_command,write_file']]);
  // 7. Tool vocabulary across every Turn.
  const tools = toolsFor('cm1', 'cm2', 'cm3', 'cm4', 'cm5', 'cm6', 'cm8');
  record('cm.tools', tools);
  check(`${tag}: one 5-tool Shell vocabulary, no agent / send_message / team`, [tools.length, tools[0]?.split(',').length, hasTool(tools, 'agent'), hasTool(tools, 'send_message'), anyTeamTool(tools)], [1, 5, false, false, false]);
  record('cm.springErrors', fs.readdirSync(ctx.runDir).filter((f) => /^spring.*\.log$/.test(f)).map((f) => (fs.readFileSync(`${ctx.runDir}/${f}`, 'utf8').match(/requires persisted default or auto-edit approval mode|did not confirm the Session approval mode/g) ?? []).length).reduce((s, n) => s + n, 0));
  check(`${tag}: no approval-mode IllegalStateException in the Spring log`, ctx.results['cm.springErrors'], 0);
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
  else if (phase === 'ownshell') await phaseOwnerOnlyShell();
  else if (phase === 'opfiles') await phaseOperatorFiles();
  else if (phase === 'files1') await phaseFiles(false);
  else if (phase === 'files2') await phaseFiles(true);
  else if (phase === 'restart-on') await phaseRestartOn();
  else if (phase === 'sp-off') await phaseSpringOnly(false);
  else if (phase === 'sp-on') await phaseSpringOnly(true);
  else if (phase === 'child') await phaseChild();
  else if (phase === 'childctl') await phaseChild(true);
  else if (phase === 'rollback') await phaseRollback();
  else if (phase === 'defs') await phaseDefs();
  else if (phase === 'replaykind') await phaseReplayKind();
  else if (phase === 'internal') await phaseInternal();
  else if (phase === 'cwdrename') await phaseCwdRename();
  else if (phase === 'renameprobe') await phaseRenameProbe();
  else if (phase === 'casemode') await phaseCaseMode();
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
