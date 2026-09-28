// Full A/B suite for PR #12918. Usage: node suite.mjs <head|base> <fakePort>
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SP, Daemon, prepareHome, setTrust, modeOf, findJsonl, approvalRecords, sleep } from './lib.mjs';

const arm = process.argv[2];
const fakePort = Number(process.argv[3]);
const root = path.join(SP, 'runs', `suite-${arm}`);
fs.rmSync(root, { recursive: true, force: true });
const ws = path.join(root, 'ws');
const { home, qwenHome } = prepareHome({ root, ws, fakePort });
const wt = path.join(SP, `wt-${arm}`);
const logFile = path.join(root, 'daemon.log');
const R = { arm, phases: {} };
const out = (phase, key, val) => {
  (R.phases[phase] ??= {})[key] = val;
  console.log(`[${arm}] ${phase} ${key} = ${JSON.stringify(val)}`);
};
const save = () => fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(R, null, 2));

let d;
async function boot(extraEnv = {}) {
  d = new Daemon({ wt, home, qwenHome, ws, fakePort, logFile, extraEnv });
  await d.start();
  return d;
}

async function newActiveSession(label) {
  const s = await d.createSession();
  const sub = d.subscribe(s.sessionId, s.clientId);
  await sub.ready;
  await runPrompt(s, sub, `hello from ${label}`);
  return { ...s, sub, label };
}

async function runPrompt(s, sub, text, { onPermission, waitMs = 30000 } = {}) {
  const r = await d.prompt(s.sessionId, text, s.clientId);
  if (r.status !== 202 && r.status !== 200) throw new Error(`prompt ${r.status} ${JSON.stringify(r.json)}`);
  const promptId = r.json?.promptId;
  const perms = [];
  const done = sub.waitFor((e) => e.type === 'turn_complete' && (!promptId || e.promptId === promptId || e.data?.promptId === promptId), waitMs);
  // watch for permission requests in parallel
  let handled = new Set();
  const poll = (async () => {
    for (let i = 0; i < waitMs / 100; i++) {
      for (const e of sub.events) {
        if (e.type === 'permission_request' && !handled.has(e.data.requestId)) {
          handled.add(e.data.requestId);
          perms.push({ tool: e.data.toolCall?.title ?? e.data.toolCall?.kind, toolName: e.data.toolCall?._meta?.toolName ?? e.data.toolCall?.rawInput?.plan ? 'exit_plan_mode' : undefined, options: e.data.options.map((o) => o.optionId) });
          if (onPermission) await onPermission(e);
        }
      }
      if (sub.events.some((e) => e.type === 'turn_complete' && (e.promptId === promptId || e.data?.promptId === promptId))) return;
      await sleep(100);
    }
  })();
  const tc = await done;
  await poll;
  return { turnComplete: tc?.data?.stopReason ?? null, perms };
}

async function vote(requestId, body, clientId) {
  return d.req('POST', `/permission/${requestId}`, body, clientId);
}

async function coldLoad(s, extra = {}) {
  s.sub?.close();
  await d.detach(s.sessionId, s.clientId);
  await d.waitClosed(s.sessionId);
  const l = await d.load(s.sessionId, extra);
  if (l.status !== 200) return { status: l.status, body: l.json };
  s.clientId = l.json.clientId;
  s.sub = d.subscribe(s.sessionId, s.clientId);
  await s.sub.ready;
  return modeOf(l.json);
}

async function liveMode(s) {
  const c = await d.req('GET', `/session/${s.sessionId}/context`, undefined, s.clientId);
  const st = c.json?.state ?? {};
  return { live: st.modes?.currentModeId, planExecutionMode: st.modes?._meta?.planExecutionMode, configOption: (st.configOptions || []).find((o) => o.id === 'mode')?.currentValue };
}

const recs = (s) => approvalRecords(findJsonl(qwenHome, s.sessionId));

try {
  // ---------------- Phase 1: trusted daemon #1 ----------------
  await boot();
  out('p1', 'daemonPid', d.pid);
  const A = await newActiveSession('A');
  const B = await newActiveSession('B');
  out('p1', 'A.setYolo', (await d.setMode(A.sessionId, 'yolo', {}, A.clientId)).json);
  await sleep(300);
  out('p1', 'A.records.beforeDetach', recs(A));
  out('p1', 'S1.A.coldLoad', await coldLoad(A));
  out('p1', 'S1.B.live', await liveMode(B));
  // real effect: write_file with the restored mode
  const f1 = path.join(ws, 's1-after-cold-load.txt');
  const r1 = await runPrompt(A, A.sub, `DO:write_file:${f1}`, {
    waitMs: 20000,
    onPermission: async (e) => {
      await vote(e.data.requestId, { outcome: { outcome: 'cancelled' } }, A.clientId);
    },
  });
  out('p1', 'S1.A.writeFile', { permissionRequests: r1.perms.length, stop: r1.turnComplete, fileExists: fs.existsSync(f1) });
  // unchanged workspace reload
  const rl = await d.req('POST', '/workspace/reload', {}, A.clientId);
  out('p1', 'S2.reload.status', rl.status);
  await sleep(500);
  out('p1', 'S2.A.afterReload.live', await liveMode(A));
  out('p1', 'S2.A.afterReload.cold', await coldLoad(A));

  // Plan predecessor sessions (C used trusted after restart, C2 used after untrust)
  const C = await newActiveSession('C');
  await d.setMode(C.sessionId, 'yolo', {}, C.clientId);
  out('p1', 'C.setPlan', (await d.setMode(C.sessionId, 'plan', {}, C.clientId)).json);
  const C2 = await newActiveSession('C2');
  await d.setMode(C2.sessionId, 'yolo', {}, C2.clientId);
  await d.setMode(C2.sessionId, 'plan', {}, C2.clientId);
  // Plan with separately selected execution policy
  const D = await newActiveSession('D');
  await d.setMode(D.sessionId, 'yolo', {}, D.clientId);
  out('p1', 'D.planYolo', (await d.setMode(D.sessionId, 'yolo', { planMode: true }, D.clientId)).json);
  out('p1', 'D.planAutoEdit', (await d.setMode(D.sessionId, 'auto-edit', { planMode: true }, D.clientId)).json);
  // explicit override
  const E = await newActiveSession('E');
  await d.setMode(E.sessionId, 'yolo', {}, E.clientId);
  out('p1', 'S5.E.coldLoad.override=default', await coldLoad(E, { approvalMode: 'default' }));
  out('p1', 'S5.E.coldLoad.noOverride', await coldLoad(E));
  // A2/A3 = yolo sessions kept untouched for safe-mode + invalid-tail probes
  const A2 = await newActiveSession('A2');
  await d.setMode(A2.sessionId, 'yolo', {}, A2.clientId);
  const A3 = await newActiveSession('A3');
  await d.setMode(A3.sessionId, 'yolo', {}, A3.clientId);
  // unused sessions
  const U0 = await d.createSession();
  await d.detach(U0.sessionId, U0.clientId);
  await d.waitClosed(U0.sessionId);
  out('p1', 'S7.U0.noActivity.jsonl', findJsonl(qwenHome, U0.sessionId) ?? null);
  const U1 = await d.createSession();
  out('p1', 'S7.U1.setYoloOnly', (await d.setMode(U1.sessionId, 'yolo', {}, U1.clientId)).json);
  await sleep(300);
  const u1file = findJsonl(qwenHome, U1.sessionId);
  out('p1', 'S7.U1.jsonl', u1file ? fs.readFileSync(u1file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => `${r.type}/${r.subtype ?? ''}`) : null);
  await d.detach(U1.sessionId, U1.clientId);
  await d.waitClosed(U1.sessionId);
  const u1load = await d.load(U1.sessionId);
  out('p1', 'S7.U1.coldLoad', u1load.status === 200 ? modeOf(u1load.json) : { status: u1load.status, code: u1load.json?.code ?? u1load.json?.error });
  if (u1load.json?.clientId) await d.detach(U1.sessionId, u1load.json.clientId);
  const list = await d.req('GET', `/workspace/${encodeURIComponent(ws)}/sessions?limit=50`);
  const ids = JSON.stringify(list.json);
  out('p1', 'S7.sessionList', { status: list.status, U0listed: ids.includes(U0.sessionId), U1listed: ids.includes(U1.sessionId), U1entry: (list.json?.sessions || []).find((x) => x.sessionId === U1.sessionId) ?? null });
  // rewind
  const RW = await newActiveSession('RW');
  await d.setMode(RW.sessionId, 'yolo', {}, RW.clientId);
  await runPrompt(RW, RW.sub, 'second turn');
  await d.setMode(RW.sessionId, 'auto-edit', {}, RW.clientId);
  await runPrompt(RW, RW.sub, 'third turn');
  const snaps = await d.req('GET', `/session/${RW.sessionId}/rewind/snapshots`);
  const target = (snaps.json?.snapshots ?? []).find((x) => x.turnIndex === 1);
  const rw = await d.req('POST', `/session/${RW.sessionId}/rewind`, { promptId: target?.promptId }, RW.clientId);
  out('p1', 'S8.rewind', { snapshots: (snaps.json?.snapshots ?? []).map((x) => x.turnIndex), status: rw.status, body: rw.json && { rewound: rw.json.rewound, targetTurnIndex: rw.json.targetTurnIndex } });
  await sleep(300);
  out('p1', 'S8.RW.liveAfterRewind', await liveMode(RW));
  out('p1', 'S8.RW.coldLoad', await coldLoad(RW));
  save();
  for (const s of [A, B, C, C2, D, E, A2, A3, RW]) s.sub?.close();
  await d.stop();

  // ---------------- Phase 2: restart, trusted ----------------
  await boot();
  out('p2', 'daemonPid', d.pid);
  const cold = async (s, extra) => {
    const l = await d.load(s.sessionId, extra);
    s.clientId = l.json?.clientId;
    s.sub = d.subscribe(s.sessionId, s.clientId);
    await s.sub.ready;
    return modeOf(l.json);
  };
  out('p2', 'S1.A.afterRestart', await cold(A));
  out('p2', 'S1.B.afterRestart', await cold(B));
  out('p2', 'S3.C.afterRestart', await cold(C));
  const exitC = await runPrompt(C, C.sub, 'DO:exit_plan', {
    onPermission: async (e) => {
      const opts = e.data.options.map((o) => o.optionId);
      const pick = opts.includes('restore_previous') ? 'restore_previous' : opts[0];
      R.phases.p2.exitCOptions = opts;
      await vote(e.data.requestId, { outcome: { outcome: 'selected', optionId: pick } }, C.clientId);
    },
  });
  out('p2', 'S3.C.exitPlan', { perms: exitC.perms.length, stop: exitC.turnComplete, options: R.phases.p2.exitCOptions });
  await sleep(300);
  out('p2', 'S3.C.modeAfterApprovedExit', await liveMode(C));
  out('p2', 'S4.D.afterRestart', await cold(D));
  const exitD = await runPrompt(D, D.sub, 'DO:exit_plan', {
    onPermission: async (e) => {
      const opts = e.data.options.map((o) => o.optionId);
      await vote(e.data.requestId, { outcome: { outcome: 'selected', optionId: opts.includes('restore_previous') ? 'restore_previous' : opts[0] }, expectedPlanExecutionMode: 'auto-edit' }, D.clientId);
    },
  });
  out('p2', 'S4.D.exitPlan', { perms: exitD.perms.length, stop: exitD.turnComplete });
  await sleep(300);
  out('p2', 'S4.D.modeAfterApprovedExit', await liveMode(D));
  out('p2', 'S5.E.afterRestart', await cold(E));
  save();
  for (const s of [A, B, C, D, E]) s.sub?.close();
  await d.stop();

  // ---------------- Phase 3: restart with workspace untrusted ----------------
  setTrust(qwenHome, ws, 'DO_NOT_TRUST');
  await boot();
  out('p3', 'daemonPid', d.pid);
  const trust = await d.req('GET', '/workspace/trust');
  out('p3', 'trust', trust.json && { trusted: trust.json.trusted ?? trust.json.isTrusted, raw: JSON.stringify(trust.json).slice(0, 200) });
  out('p3', 'S9.A.untrustedLoad', await cold(A));
  const f3 = path.join(ws, 's9-untrusted.txt');
  const r3 = await runPrompt(A, A.sub, `DO:write_file:${f3}`, {
    onPermission: async (e) => {
      await vote(e.data.requestId, { outcome: { outcome: 'cancelled' } }, A.clientId);
    },
  });
  out('p3', 'S9.A.writeFile', { permissionRequests: r3.perms.length, stop: r3.turnComplete, fileExists: fs.existsSync(f3) });
  out('p3', 'S9b.C2.untrustedLoad', await cold(C2));
  const exitC2 = await runPrompt(C2, C2.sub, 'DO:exit_plan', {
    onPermission: async (e) => {
      const opts = e.data.options.map((o) => o.optionId);
      await vote(e.data.requestId, { outcome: { outcome: 'selected', optionId: opts.includes('restore_previous') ? 'restore_previous' : opts[0] } }, C2.clientId);
    },
  });
  out('p3', 'S9b.C2.exitPlan', { perms: exitC2.perms.length, stop: exitC2.turnComplete });
  await sleep(300);
  out('p3', 'S9b.C2.modeAfterApprovedExit', await liveMode(C2));
  save();
  for (const s of [A, C2]) s.sub?.close();
  await d.stop();
  setTrust(qwenHome, ws, 'TRUST_FOLDER');

  // ---------------- Phase 4: trusted, QWEN_CODE_SAFE_MODE=1 ----------------
  await boot({ QWEN_CODE_SAFE_MODE: '1' });
  out('p4', 'daemonPid', d.pid);
  out('p4', 'S10.A2.safeModeLoad', await cold(A2));
  A2.sub?.close();
  await d.stop();

  // ---------------- Phase 5: trusted, normal; invalid tail; persist; write failure ----------------
  const a3file = findJsonl(qwenHome, A3.sessionId);
  const lines = fs.readFileSync(a3file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const last = lines[lines.length - 1];
  const mk = (parentUuid, payload) => ({ uuid: randomUUID(), parentUuid, sessionId: A3.sessionId, timestamp: new Date().toISOString(), type: 'system', subtype: 'session_approval_mode', cwd: last.cwd, version: last.version, systemPayload: payload });
  const bad1 = mk(last.uuid, { mode: 'bogus-mode' });
  const bad2 = mk(bad1.uuid, { mode: 'plan', prePlanMode: 'plan' });
  fs.appendFileSync(a3file, JSON.stringify(bad1) + '\n' + JSON.stringify(bad2) + '\n');
  await boot();
  out('p5', 'daemonPid', d.pid);
  out('p5', 'S10.A2.normalLoadAfterSafe', await cold(A2));
  out('p5', 'S11.A3.invalidTailLoad', await cold(A3));
  out('p5', 'S9.A.afterRetrust', await cold(A));
  // write failure: make jsonl read-only, change mode
  const W = await newActiveSession('W');
  const wfile = findJsonl(qwenHome, W.sessionId);
  fs.chmodSync(wfile, 0o444);
  const wm = await d.setMode(W.sessionId, 'yolo', {}, W.clientId);
  await sleep(500);
  out('p5', 'S12.W.setModeWhileReadOnly', { status: wm.status, body: wm.json });
  out('p5', 'S12.W.live', await liveMode(W));
  fs.chmodSync(wfile, 0o644);
  out('p5', 'S12.W.records', recs(W));
  const wr = await runPrompt(W, W.sub, 'after read-only window', { waitMs: 20000 });
  await sleep(300);
  out('p5', 'S12.W.promptAfterRestore', { stop: wr.turnComplete, records: recs(W), userRecords: fs.readFileSync(wfile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'user').length });
  out('p5', 'S12.W.coldLoad', await coldLoad(W));
  // persist:true isolation (last: it changes the workspace default)
  const F = await newActiveSession('F');
  await d.setMode(F.sessionId, 'auto-edit', {}, F.clientId);
  const G = await newActiveSession('G');
  const gp = await d.setMode(G.sessionId, 'yolo', { persist: true }, G.clientId);
  out('p5', 'S6.G.persist', gp.json);
  await sleep(1500);
  const wsSettings = path.join(ws, '.qwen', 'settings.json');
  out('p5', 'S6.workspaceSettings', fs.existsSync(wsSettings) ? JSON.parse(fs.readFileSync(wsSettings, 'utf8')) : null);
  out('p5', 'S6.F.liveAfterPersist', await liveMode(F));
  out('p5', 'S6.F.records', recs(F));
  out('p5', 'S6.F.coldLoad', await coldLoad(F));
  const H = await d.createSession();
  out('p5', 'S6.H.newSession', await liveMode(H));
  save();
  for (const s of [A, A2, A3, W, F, G]) s.sub?.close();
  await d.stop();
  // final transcript dump of records
  const dump = {};
  for (const s of [A, B, C, C2, D, E, A2, A3, RW, W, F, G]) dump[s.label] = recs(s);
  out('final', 'approvalRecords', dump);
  save();
} catch (err) {
  console.error('SUITE ERROR', err);
  R.error = String(err?.stack ?? err);
  save();
  await d?.stop();
  process.exitCode = 1;
}
