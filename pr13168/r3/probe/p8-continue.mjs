// VERIFICATION RIG ONLY (PR #13168 R2) P8: the continue route (changed by this PR to carry the
// context slot). Harness A: tool turn; the context is fetched and the tool result commits; A is
// SIGKILLed while the next model round is in flight. Harness B takes over (driveRuntimeRecovery)
// and /managed-runtime/continue's the Turn; in the continuation the model calls one more tool.
// Then a fresh ordinary tool Turn on B.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { startGateProxy, ledgerFrom, ctxOps, markersIn } from './lib2.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/2';
const st = process.env.ST ?? 'j';
const ws = `ws-${st}`;
const name = `p8-continue-${L.ARM}-${st}`;
L.openLog(name);
const dir = `${L.ROOTS}/${st}/w`;
fs.mkdirSync(`${dir}/src`, { recursive: true });
fs.writeFileSync(`${dir}/QWEN.md`, 'R2-QWEN-MARKER\n');
fs.writeFileSync(`${dir}/proof.txt`, 'proof\n');
fs.writeFileSync(`${dir}/src/a.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
let phase = 'A';
let heldResolve;
const held = new Promise((r) => (heldResolve = r));
const M = ['R2-QWEN-MARKER'];
const model = await L.startModel({
  cont: async ({ round }) => {
    if (phase === 'A') {
      if (round === 0) return { calls: [['read_file', { file_path: 'proof.txt' }]] };
      heldResolve();
      await new Promise(() => {});
    }
    if (round === 1) return { calls: [[PROFILE.endsWith('/2') ? 'glob' : 'read_file', PROFILE.endsWith('/2') ? { pattern: 'src/*' } : { file_path: 'src/a.ts' }]] };
    return { text: 'DONE continued' };
  },
  t: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'proof.txt' }]] } : { text: 'DONE' }),
});
const proxy = await startGateProxy();
const LEASE = 10_000;
const A = await new L.Harness({ name: `p8a-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
let B;
const out = {};
try {
  const id = await L.createWorkspaceSession(ws, 'w');
  const sa = new L.HSession(A, id, { ...L.storeConnection(A, ws), leaseDurationMs: LEASE });
  L.say('create on A', `${PROFILE} -> ${(await sa.create({ toolProfile: PROFILE })).status}`);
  const sub = await sa.submit('[[S:cont]] go');
  await Promise.race([held, L.sleep(60_000)]);
  const aReqs = model.requests.filter((q) => q.script === 'cont');
  out.A = aReqs.map((q) => ({ round: q.round, markers: markersIn(q, M) }));
  L.say('A model rounds', JSON.stringify(out.A));
  L.say('A broker', ledgerFrom(proxy.ledger).join(' | '));
  A.child.kill('SIGKILL');
  await L.sleep(LEASE + 3000);
  B = await new L.Harness({ name: `p8b-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
  phase = 'B';
  const sb = new L.HSession(B, id, { ...L.storeConnection(B, ws), leaseDurationMs: LEASE });
  let load;
  for (let i = 0; i < 12; i++) {
    load = await sb.load({ driveRuntimeRecovery: true });
    if (load.status !== 503) break;
    await L.sleep(5000);
  }
  const report = load.json?._meta?.['qwen.daemon.managedRuntimeRecovery'];
  L.say('takeover load on B', `${load.status} report=${JSON.stringify(report)?.slice(0, 200)}`);
  if (load.status === 200 && report) {
    const n = model.requests.length;
    const t0 = Date.now();
    const c = await B.json(`/session/${id}/managed-runtime/continue`, { promptId: sub.promptId, checkpointId: report.checkpointId, activationId: report.activationId }, { clientId: sb.clientId });
    L.say('continue', `${c.status} ${JSON.stringify(c.json).slice(0, 200)}`);
    await sb.waitIdle(120_000);
    const events = (await sb.transcript()).filter((e) => e.promptId === sub.promptId);
    out.cont = { requests: model.requests.slice(n).map((q) => ({ round: q.round, tools: q.tools, markers: markersIn(q, M) })), terminal: events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}(${e.data?.stopReason ?? ''})`), broker: ledgerFrom(proxy.ledger, t0), ctxOps: ctxOps(proxy.ledger, t0).length, trace: L.toolTrace(events, 160) };
    L.say('continued requests', JSON.stringify(out.cont.requests));
    L.say('continued terminal', JSON.stringify(out.cont.terminal));
    L.say('continued trace', JSON.stringify(out.cont.trace));
    L.say('continued broker', out.cont.broker.join(' | '));
    const n2 = model.requests.length;
    const t2 = Date.now();
    const r = await sb.prompt('[[S:t]] ordinary tool turn on B');
    out.next = { summary: L.summarizeTurn(r), requests: model.requests.slice(n2).map((q) => ({ round: q.round, markers: markersIn(q, M) })), ctxOps: ctxOps(proxy.ledger, t2).length };
    L.say('next ordinary turn on B', JSON.stringify(out.next));
    L.check('continued Turn completes', out.cont.terminal.some((t) => /turn_complete\(end_turn\)/.test(t)), JSON.stringify(out.cont.terminal));
    if (PROFILE.endsWith('/2')) L.check('continued request still advertises glob (inherited #13166 fix)', out.cont.requests[0]?.tools.includes('glob'), JSON.stringify(out.cont.requests[0]?.tools));
    L.say('OBSERVE', `continuation context: ${JSON.stringify(out.cont.requests.map((q) => q.markers.length))}; ctxOps during continuation=${out.cont.ctxOps}`);
    L.check('next ordinary tool turn on B fetches once and carries context from request #2', out.next.ctxOps <= 1 && out.next.requests.at(-1)?.markers.length === 1, JSON.stringify(out.next));
  }
  L.say('harness B log', B.log().split('\n').filter((l) => /context|blocked|failed|refus/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '').slice(0, 200)).join(' || ') || '<none>');
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await A.stop();
  await B?.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
