// S43 (PR #13243): managed function-hook *module evaluation* on the real Hosted stack
// (Harness dist/<ARM>/cli.js + Spring Session Store + embedded Runtime Broker + local worker dist).
// Every scenario uses its own Workspace (storage letter) and a UserPromptSubmit function Hook whose handler
// module's top-level code is the variable under test (probe/r43/*.mjs, see manifest43.mjs).
// usage: DB=<db> ARM=<dist label> [ONLY=s1,s2,...] node s43-module-eval.mjs
import fs from 'node:fs';
import { RUN, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, pin, hookLedger, hookRecords, j, sleep, holderOf, sql, startBrokerProxy, ledgerLines } from './lib.mjs';
import { STORAGE43 } from './manifest43.mjs';

const arm = process.env.ARM;
if (!arm) throw new Error('ARM required');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const R = new Report(`s43-${arm}${process.env.TAG ? '-' + process.env.TAG : ''}`);
const obs = [];
const put = (scenario, key, value) => {
  obs.push({ scenario, key, value });
  R.note(`${scenario} ${key}`, typeof value === 'string' ? value : j(value));
};
const model = await startModel();
const proxy = process.env.PROXY ? await startBrokerProxy() : null;
let h = await new Harness({ name: `s43-${arm}`, modelUrl: model.url, arm, brokerUrl: proxy?.url }).start();
const gate = (name) => `${RUN}/r43-gate-${name}`;
for (const g of ['gate1', 'gate2', 'gate3', 'gate4', 'gate5']) fs.rmSync(gate(g), { force: true });

const evals = (module) => hookLedger((e) => e.module === module);
const count = (module, kind) => evals(module).filter((e) => e.kind === kind).length;
const exec = (id) => {
  const rs = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'UserPromptSubmit');
  return rs.map((r) => `${r.rec.run?.state}/${j(r.rec.run?.execution)}${r.rec.run?.reason ? '/' + r.rec.run.reason : ''}${r.rec.resultRef ? '+result' : ''}`).join(' | ') || '<none>';
};
async function safe(fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 'ERR', err: String(e?.name === 'TimeoutError' ? 'client timeout' : e?.message ?? e).slice(0, 160), ms: Date.now() - t0 };
  }
}
const st = (r) => `${r.status}${r.json?.code ? ' ' + r.json.code : ''}${r.err ? ' ' + r.err : ''} (${r.ms} ms)`;
async function idleWithin(s, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const x = await s.status().catch(() => null);
    if (x && !x.hasActivePrompt) return { idle: true, ms: Date.now() - t0, status: x };
    await sleep(100);
  }
  return { idle: false, ms: Date.now() - t0, status: await s.status().catch(() => null) };
}
async function terminal(s, promptId) {
  const ev = (await s.transcript()).filter((e) => e.promptId === promptId);
  return ev.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}${e.type === 'turn_error' ? `[${j(e.data).slice(0, 160)}]` : ''}`).join(',') || '<none>';
}
async function waitLedger(module, kind, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (count(module, kind) > 0) return Date.now() - t0;
    await sleep(50);
  }
  return null;
}
// One prompt, bounded: submit, wait idle, report terminal + timing.
async function promptBounded(s, text, ms) {
  const sub = await safe(() => s.submit(text));
  if (sub.status !== 202) return { admitted: false, line: `admit=${st(sub)}` };
  const w = await idleWithin(s, ms);
  if (!w.idle) return { admitted: true, idle: false, promptId: sub.promptId, line: `admit=202 STILL ACTIVE after ${w.ms} ms` };
  return { admitted: true, idle: true, promptId: sub.promptId, ms: w.ms, line: `admit=202 terminal=${await terminal(s, sub.promptId)} idle after ${w.ms} ms recoveryBlocked=${w.status?.recoveryBlocked}` };
}
async function session(WS, harness = h) {
  const w = await workspace(STORAGE43[WS], WS);
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(harness, id, storeConnection(harness, w.workspaceId));
  const c = await s.create({ hookCatalog: pin(WS) });
  if (c.status !== 200) throw new Error(`create ${WS}: ${c.status} ${j(c.json)}`);
  return { w, id, s };
}
// A Session without Hooks in the same Workspace: does the Workspace still serve other Sessions?
async function neighbour(w, label) {
  const id = await createWorkspaceSession(w.workspaceId);
  const o = new HSession(h, id, storeConnection(h, w.workspaceId));
  const c = await safe(() => o.create());
  if (c.status !== 200) return put(label, 'neighbour Session (no Hooks, same Workspace)', `create=${st(c)}`);
  const f = `nb-${Date.now()}.txt`;
  const p = await promptBounded(o, script([[call('write_file', { file_path: f, content: 'nb' })]], 'NB-DONE'), 30_000);
  put(label, 'neighbour Session (no Hooks, same Workspace)', `${p.line} wrote=${fs.existsSync(`${w.dir}/${f}`)}`);
  await safe(() => o.detach());
}
const want = (k) => !ONLY || ONLY.includes(k);

try {
  // S1: never-settling top-level await, manifest timeout 2 s.
  if (want('s1')) {
    const L = 'S1 never-settling module (timeout 2000)';
    const { w, id, s } = await session('ws-43-hang');
    const p = await promptBounded(s, script([], 'S1-DONE'), 30_000);
    put(L, 'turn', p.line);
    put(L, 'module top-level runs / callbacks', `eval-start=${count('hang', 'eval-start')} eval-done=${count('hang', 'eval-done')} callback=${count('hang', 'callback')}`);
    put(L, 'hook execution record', exec(id));
    put(L, 'lease holder', holderOf(STORAGE43['ws-43-hang']));
    if (!p.idle) {
      const c0 = Date.now();
      const c = await safe(() => s.cancel());
      const w2 = await idleWithin(s, 20_000);
      put(L, 'cancel', `cancel=${st(c)} ${w2.idle ? `idle after ${Date.now() - c0} ms terminal=${await terminal(s, p.promptId)}` : `STILL ACTIVE ${Date.now() - c0} ms after cancel`}`);
    }
    const n = await promptBounded(s, script([], 'S1-NEXT'), 30_000);
    put(L, 'next prompt, same Session', n.line);
    put(L, 'hook execution records after next prompt', exec(id));
    const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'detach', st(d));
    await neighbour(w, L);
  }

  // S2: cancel while the module's top-level await is pending (manifest timeout 60 s), then let it finish.
  if (want('s2')) {
    const L = 'S2 cancel during evaluation (timeout 60000)';
    const { id, s } = await session('ws-43-gate1');
    const sub = await s.submit(script([], 'S2-DONE'));
    const started = await waitLedger('gate1', 'eval-start', 30_000);
    put(L, 'module evaluation started', started === null ? 'NOT within 30 s' : `after ${started} ms`);
    await sleep(500);
    const c0 = Date.now();
    const c = await safe(() => s.cancel());
    const w2 = await idleWithin(s, 20_000);
    put(L, 'cancel', `cancel=${st(c)} ${w2.idle ? `idle after ${Date.now() - c0} ms terminal=${await terminal(s, sub.promptId)}` : `STILL ACTIVE ${Date.now() - c0} ms after cancel`}`);
    put(L, 'hook execution record after cancel', exec(id));
    if (w2.idle) {
      const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
      put(L, 'detach while evaluation still pending', st(d));
    }
    fs.writeFileSync(gate('gate1'), 'open');
    const done = await waitLedger('gate1', 'eval-done', 10_000);
    put(L, 'gate opened -> module evaluation finished', done === null ? 'NOT within 10 s' : `after ${done} ms`);
    if (!w2.idle) {
      const w3 = await idleWithin(s, 30_000);
      put(L, 'turn after gate opened', w3.idle ? `idle ${Date.now() - c0} ms after cancel terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE');
      put(L, 'hook execution record', exec(id));
    }
    const n = await promptBounded(s, script([], 'S2-NEXT'), 30_000);
    put(L, 'next prompt after evaluation finished', `${n.line} callbacks=${count('gate1', 'callback')}`);
    const d2 = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'detach after evaluation finished', st(d2));
  }

  // S2d: S2 step by step with the Broker's persisted runtime-session state after each step.
  if (want('s2d')) {
    const L = 'S2d refused detach -> Broker row';
    const { id, s } = await session('ws-43-gate1');
    const owner = () => sql(`SELECT runtime_session_id, session_state, record_version FROM qwen_runtime_session WHERE harness_session_id='${id}' AND runtime_session_id LIKE 'hooks-%' ORDER BY last_active_at`).map((r) => `${r[0].slice(0, 28)}… ${r[1]} v${r[2]}`).join(' | ') || '<none>';
    const sub = await s.submit(script([], 'S2D-DONE'));
    await waitLedger('gate1', 'eval-start', 30_000);
    await sleep(500);
    await safe(() => s.cancel());
    const w2 = await idleWithin(s, 20_000);
    put(L, '1 cancel', `${w2.idle ? `idle terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE'} status.recoveryBlocked=${w2.status?.recoveryBlocked} broker=${owner()}`);
    const t2 = Date.now();
    const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, '2 detach while evaluation pending', `${st(d)} broker=${owner()}`);
    if (proxy) put(L, '2 Harness->Broker', ledgerLines(proxy.ledger, t2).join(' || '));
    fs.writeFileSync(gate('gate1'), 'open');
    const done = await waitLedger('gate1', 'eval-done', 10_000);
    await sleep(300);
    const s3 = await s.status().catch(() => null);
    put(L, '3 evaluation finished', `after ${done} ms status.recoveryBlocked=${s3?.recoveryBlocked} hasActivePrompt=${s3?.hasActivePrompt} broker=${owner()}`);
    const t4 = Date.now();
    const n = await promptBounded(s, script([], 'S2D-NEXT'), 30_000);
    if (proxy) put(L, '4 Harness->Broker', ledgerLines(proxy.ledger, t4).filter((x) => !x.includes('[status]') || x.includes('-> 4') || x.includes('-> 5')).join(' || '));
    put(L, '4 next Hook turn', `${n.line} callbacks=${count('gate1', 'callback')} broker=${owner()}`);
    put(L, '4 hook execution records', exec(id));
    put(L, '4 Harness stderr for that turn', (h.log().split('\n').filter((x) => n.promptId && x.includes(n.promptId) && !x.includes('[DAEMON] route=')).join(' || ') || '<none>').slice(0, 300));
    const d2 = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, '5 detach', `${st(d2)} broker=${owner()}`);
    const n2 = await promptBounded(s, script([], 'S2D-AGAIN'), 30_000);
    put(L, '6 another prompt', n2.line);
  }

  // S2b: same as S2 but no detach while pending: cancel, let the evaluation finish, then the next Hook turn.
  if (want('s2b')) {
    const L = 'S2b cancel, evaluation finishes, next turn (no detach in between)';
    const { id, s } = await session('ws-43-gate4');
    const sub = await s.submit(script([], 'S2B-DONE'));
    const started = await waitLedger('gate4', 'eval-start', 30_000);
    await sleep(500);
    const c0 = Date.now();
    await safe(() => s.cancel());
    const w2 = await idleWithin(s, 20_000);
    put(L, 'cancel', `started=${started} ${w2.idle ? `idle after ${Date.now() - c0} ms terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE after 20 s'}`);
    fs.writeFileSync(gate('gate4'), 'open');
    const done = await waitLedger('gate4', 'eval-done', 10_000);
    if (!w2.idle) {
      const w3 = await idleWithin(s, 30_000);
      put(L, 'turn after gate opened', w3.idle ? `idle terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE');
    }
    await sleep(300);
    const n = await promptBounded(s, script([], 'S2B-NEXT'), 30_000);
    put(L, 'next prompt after evaluation finished', `${n.line} (eval-done after ${done} ms) callbacks=${count('gate4', 'callback')}`);
    put(L, 'hook execution records', exec(id));
    const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'detach', st(d));
  }

  // S2c: cancel, then the next Hook turn while the same module is still evaluating (manifest timeout 3 s).
  if (want('s2c')) {
    const L = 'S2c next turn while evaluation still pending (timeout 3000)';
    const { id, s } = await session('ws-43-gate5');
    const sub = await s.submit(script([], 'S2C-DONE'));
    const started = await waitLedger('gate5', 'eval-start', 30_000);
    await sleep(500);
    const c0 = Date.now();
    await safe(() => s.cancel());
    const w2 = await idleWithin(s, 20_000);
    put(L, 'cancel', `started=${started} ${w2.idle ? `idle after ${Date.now() - c0} ms terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE after 20 s'}`);
    if (w2.idle) {
      const n = await promptBounded(s, script([], 'S2C-NEXT'), 30_000);
      put(L, 'next prompt while evaluation pending', `${n.line} eval-start=${count('gate5', 'eval-start')}`);
      put(L, 'hook execution records', exec(id));
    }
    fs.writeFileSync(gate('gate5'), 'open');
    await waitLedger('gate5', 'eval-done', 10_000);
    if (!w2.idle) {
      const w3 = await idleWithin(s, 30_000);
      put(L, 'turn after gate opened', w3.idle ? `idle terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE');
    }
    await sleep(300);
    const n2 = await promptBounded(s, script([], 'S2C-AFTER'), 30_000);
    put(L, 'prompt after evaluation finished', `${n2.line} callbacks=${count('gate5', 'callback')}`);
    const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'detach', st(d));
  }

  // S3: slow-but-healthy evaluation inside the 500 ms floor; manifest timeout 10 ms.
  if (want('s3')) {
    const L = 'S3 300 ms evaluation, timeout 10';
    const { id, s } = await session('ws-43-floor');
    const p = await promptBounded(s, script([], 'S3-DONE'), 30_000);
    put(L, 'turn', `${p.line} callbacks=${count('slow300', 'callback')}`);
    put(L, 'hook execution record', exec(id));
    await safe(() => s.detach());
  }

  // S4a: finite evaluation beyond the budget (1500 ms vs max(10, 500)).
  if (want('s4')) {
    const L = 'S4a 1500 ms evaluation, timeout 10';
    const { w, id, s } = await session('ws-43-over');
    const p = await promptBounded(s, script([], 'S4-DONE'), 30_000);
    put(L, 'turn', `${p.line} callbacks=${count('slow1500', 'callback')}`);
    put(L, 'hook execution record', exec(id));
    await sleep(2000);
    put(L, 'module after 2 s', `eval-done=${count('slow1500', 'eval-done')}`);
    const n = await promptBounded(s, script([], 'S4-NEXT'), 30_000);
    put(L, 'next prompt, same Session', n.line);
    const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'detach', st(d));
    const l = await safe(() => s.load());
    put(L, 'load', `${st(l)}${l.json?.recoveryRequired ? ' recoveryRequired' : ''}`);
    if (l.status === 200) {
      const a = await promptBounded(s, script([], 'S4-AFTER-LOAD'), 30_000);
      put(L, 'prompt after load', a.line);
      await safe(() => s.detach());
    }
    await neighbour(w, L);

    const L2 = 'S4b 1500 ms evaluation, timeout 3000';
    const g = await session('ws-43-govern');
    const p2 = await promptBounded(g.s, script([], 'S4B-DONE'), 30_000);
    put(L2, 'turn', `${p2.line} callbacks=${count('slow1500b', 'callback')}`);
    put(L2, 'hook execution record', exec(g.id));
    await safe(() => g.s.detach());
  }

  // S5: module that throws at top level (genuine import failure).
  if (want('s5')) {
    const L = 'S5 module throws at top level';
    const { id, s } = await session('ws-43-broken');
    const p = await promptBounded(s, script([], 'S5-DONE'), 30_000);
    put(L, 'turn', p.line);
    put(L, 'hook execution record', exec(id));
    const n = await promptBounded(s, script([], 'S5-NEXT'), 30_000);
    put(L, 'next prompt, same Session', n.line);
    const d = await safe(() => s.h.json(`/session/${id}/detach`, {}, { clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'detach', st(d));
  }

  // S7: DELETE /session while a cancelled operation's evaluation is still pending.
  if (want('s7')) {
    const L = 'S7 DELETE while evaluation pending';
    const { id, s } = await session('ws-43-gate3');
    const sub = await s.submit(script([], 'S7-DONE'));
    const started = await waitLedger('gate3', 'eval-start', 30_000);
    await sleep(500);
    const c0 = Date.now();
    await safe(() => s.cancel());
    const w2 = await idleWithin(s, 20_000);
    put(L, 'cancel', `started=${started} ${w2.idle ? `idle after ${Date.now() - c0} ms terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE after 20 s'}`);
    const del = await safe(() => s.h.json(`/session/${id}`, undefined, { method: 'DELETE', clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'DELETE while evaluation pending', st(del));
    put(L, 'lease holder', holderOf(STORAGE43['ws-43-gate3']));
    fs.writeFileSync(gate('gate3'), 'open');
    const done = await waitLedger('gate3', 'eval-done', 10_000);
    if (!w2.idle) {
      const w3 = await idleWithin(s, 30_000);
      put(L, 'turn after gate opened', w3.idle ? `idle terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE');
    }
    const del2 = await safe(() => s.h.json(`/session/${id}`, undefined, { method: 'DELETE', clientId: s.clientId, timeoutMs: 30_000 }));
    put(L, 'DELETE after evaluation finished', `${st(del2)} (eval-done after ${done} ms)`);
    put(L, 'lease holder after DELETE', holderOf(STORAGE43['ws-43-gate3']));
  }

  // S6: Harness replaced (SIGKILL) while a cancelled operation's evaluation is still pending in the worker;
  // the new Harness loads the Session and runs a Hook turn (releaseEarlierOwners meets the hold).
  if (want('s6')) {
    const L = 'S6 Harness replaced while evaluation pending';
    const WS = 'ws-43-gate2';
    const { w, id, s } = await session(WS);
    const sub = await s.submit(script([], 'S6-DONE'));
    const started = await waitLedger('gate2', 'eval-start', 30_000);
    await sleep(500);
    const c0 = Date.now();
    await safe(() => s.cancel());
    const w2 = await idleWithin(s, 20_000);
    put(L, 'cancel', `started=${started} ${w2.idle ? `idle after ${Date.now() - c0} ms terminal=${await terminal(s, sub.promptId)}` : 'STILL ACTIVE after 20 s'}`);
    put(L, 'hook execution record before replacement', exec(id));
    const holder0 = holderOf(STORAGE43[WS]);
    put(L, 'lease holder before replacement', holder0);
    await h.stop('SIGKILL');
    h = await new Harness({ name: `s43-${arm}-r`, modelUrl: model.url, arm }).start();
    const s2 = new HSession(h, id, storeConnection(h, w.workspaceId));
    let l;
    const l0 = Date.now();
    for (let i = 0; i < 60; i++) {
      l = await safe(() => s2.load());
      if (l.status === 200) break;
      await sleep(2000);
    }
    put(L, 'load in new Harness', `${st(l)} after ${Date.now() - l0} ms${l.json?.recoveryRequired ? ' recoveryRequired' : ''}`);
    if (l.status === 200) {
      const n = await promptBounded(s2, script([], 'S6-NEXT'), 30_000);
      put(L, 'Hook turn in new Harness, evaluation still pending', n.line);
      put(L, 'hook execution records', exec(id));
      put(L, 'lease holder', holderOf(STORAGE43[WS]));
      fs.writeFileSync(gate('gate2'), 'open');
      const done = await waitLedger('gate2', 'eval-done', 10_000);
      put(L, 'gate opened -> evaluation finished', `after ${done} ms`);
      const n2 = await promptBounded(s2, script([], 'S6-AFTER'), 30_000);
      put(L, 'Hook turn after evaluation finished', `${n2.line} callbacks=${count('gate2', 'callback')}`);
      put(L, 'lease holder after', holderOf(STORAGE43[WS]));
      const d = await safe(() => s2.h.json(`/session/${id}/detach`, {}, { clientId: s2.clientId, timeoutMs: 30_000 }));
      put(L, 'detach', st(d));
    }
    put(L, 'Harness log: hook owner warnings', (h.log().match(/Earlier Hook owner release refused[^\n]*|Hook owner release held[^\n]*/g) ?? []).slice(0, 3).join(' || ') || '<none>');
  }
} catch (e) {
  R.check('probe completed without exception', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  for (const g of ['gate1', 'gate2', 'gate3', 'gate4', 'gate5']) fs.writeFileSync(gate(g), 'open');
  await h.close?.();
  await h.stop();
  await model.close();
  await proxy?.close();
  R.done({ arm, obs });
}
