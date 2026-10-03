// VERIFICATION RIG ONLY (PR #13168 R2) P3: a stalled workspace-context read on the real stack.
// MODE=cancel: the proxy holds the control; 1 s after it arrives the client cancels the Turn; the held
//              request is forwarded (real worker reply) HOLD_MS after the cancel.
// MODE=stall:  the proxy holds it and never forwards (the Harness's own request timeout decides).
// Then a second tool turn shows whether the slot latched and whether the read is retried.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { startGateProxy, ledgerFrom, ctxOps, markersIn } from './lib2.mjs';

const MODE = process.env.MODE ?? 'cancel';
const HOLD_MS = Number(process.env.HOLD_MS ?? 8000);
const st = process.env.ST ?? 'e';
const ws = `ws-${st}`;
const name = `p3-${MODE}-${L.ARM}-${st}`;
L.openLog(name);
const root = `${L.ROOTS}/${st}`;
const dir = `${root}/w`;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/QWEN.md`, 'R2-QWEN-MARKER\n');
fs.writeFileSync(`${dir}/AGENTS.md`, 'R2-AGENTS-MARKER\n');
fs.writeFileSync(`${dir}/proof.txt`, 'proof\n');
L.seedRegistry(ws, `st-${st}`);
const model = await L.startModel({
  t: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'proof.txt' }]] } : { text: 'DONE' }),
});
const proxy = await startGateProxy();
const h = await new L.Harness({ name: `p3-${MODE}-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const execRows = () => Number(L.one(`SELECT COUNT(*) FROM qwen_tool_execution`));
const out = { arm: L.ARM, mode: MODE };
try {
  const s = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
  L.say('create', (await s.create({ toolProfile: 'hosted-workspace-files/1' })).status);
  const rows0 = execRows();
  const gate = proxy.hold((e) => e.kind === 'workspace-context');
  const n = model.requests.length;
  const t0 = Date.now();
  const sub = await s.submit('[[S:t]] read proof');
  L.say('submit', `${sub.status}`);
  const arrived = await Promise.race([gate.arrived.then(() => true), L.sleep(60_000).then(() => false)]);
  L.say('context read held at proxy', `${arrived} after ${Date.now() - t0} ms`);
  let tCancel = null;
  let settled;
  if (MODE === 'cancel') {
    await L.sleep(1000);
    tCancel = Date.now();
    const c = await h.json(`/session/${s.sessionId}/cancel`, {}, { clientId: s.clientId });
    L.say('cancel', `${c.status}`);
    const forward = L.sleep(HOLD_MS).then(() => {
      out.forwardedAt = Date.now() - tCancel;
      gate.release('forward');
    });
    const st2 = await s.waitIdle(120_000);
    settled = Date.now() - tCancel;
    out.settleMs = settled;
    L.say('settled after cancel', `${settled} ms (held reply forwarded at +${HOLD_MS} ms) status=${JSON.stringify(st2)}`);
    await forward;
    await L.sleep(2500);
  } else {
    const st2 = await s.waitIdle(180_000);
    settled = Date.now() - t0;
    out.turnMs = settled;
    L.say('turn idle (stall, never forwarded)', `${settled} ms status=${JSON.stringify(st2)}`);
  }
  const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
  out.terminal = events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}(${e.data?.stopReason ?? ''})`);
  out.trace = L.toolTrace(events, 200);
  out.ledger = ledgerFrom(proxy.ledger, t0);
  out.afterCancel = tCancel ? ledgerFrom(proxy.ledger, tCancel) : null;
  out.rows = execRows() - rows0;
  out.holders = L.holders();
  out.t1Requests = model.requests.slice(n).map((q) => ({ round: q.round, markers: markersIn(q, ['R2-QWEN-MARKER']) }));
  out.stderr = h.log().split('\n').filter((l) => /context read failed/.test(l)).map((l) => l.replace(/^.*qwen serve: /, '').slice(0, 200));
  L.say('T1 terminal', JSON.stringify(out.terminal));
  L.say('T1 tool trace', JSON.stringify(out.trace));
  L.say('T1 broker ledger', out.ledger.join(' | '));
  if (out.afterCancel) L.say('broker after cancel', out.afterCancel.join(' | '));
  L.say('T1 model requests', JSON.stringify(out.t1Requests));
  L.say('qwen_tool_execution rows added by T1', out.rows);
  L.say('lease holders after T1', JSON.stringify(out.holders));
  L.say('harness stderr', JSON.stringify(out.stderr));

  // Second tool turn: is the read retried, and does context arrive?
  const n2 = model.requests.length;
  const t2 = Date.now();
  const r2 = await s.prompt('[[S:t]] read proof again', 120_000);
  out.t2 = { summary: L.summarizeTurn(r2), ctxOps: ctxOps(proxy.ledger, t2).length, requests: model.requests.slice(n2).map((q) => ({ round: q.round, markers: markersIn(q, ['R2-QWEN-MARKER']) })), ledger: ledgerFrom(proxy.ledger, t2) };
  L.say('T2', `${out.t2.summary} ctxOps=${out.t2.ctxOps} requests=${JSON.stringify(out.t2.requests)}`);
  L.say('T2 broker ledger', out.t2.ledger.join(' | '));

  if (MODE === 'cancel') {
    const dispatchedAfterCancel = (out.afterCancel ?? []).some((x) => /executions:prepare|:start/.test(x));
    L.check('cancel settles promptly (< 3 s) while the read is still held', settled < 3000, `${settled} ms`);
    L.check('Turn ends cancelled', out.terminal.some((t) => /cancel/.test(t)), JSON.stringify(out.terminal));
    L.check('no tool dispatched after cancel (no executions:prepare/:start)', !dispatchedAfterCancel, (out.afterCancel ?? []).join(' | '));
    L.check('no qwen_tool_execution row for the cancelled Turn', out.rows === 0, String(out.rows));
    L.check('acquired lease released', (out.afterCancel ?? out.ledger).some((x) => /:release -> 200/.test(x)) && out.holders.every(([, h2]) => h2 === '<none>'), JSON.stringify(out.holders));
    L.check('slot not latched: T2 reads again and carries context', out.t2.ctxOps === 1 && out.t2.requests[1]?.markers.length === 1, JSON.stringify(out.t2));
  } else {
    L.say('OBSERVE', `stalled read: T1 took ${out.turnMs} ms; tool still ran=${out.rows === 1}; T2 retried=${out.t2.ctxOps}`);
  }
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
