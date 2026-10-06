// VERIFICATION RIG ONLY: S9 coordinator-driven continuation of a files/2 (or shell/2) Turn.
// Harness A runs glob, its result commits, then A is SIGKILLed while the model round after the
// result is in flight. Harness B takes the Session over (driveRuntimeRecovery) and is told to
// /managed-runtime/continue it. Which tools does the continued model request advertise, and can
// the model still call glob there?
import fs from 'node:fs';
import * as L from './lib.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/2';
const name = `s9-continue-${L.ARM}-${PROFILE.replace(/.*\//, 'v').replace(/hosted-workspace-/, '')}${PROFILE.includes('shell') ? '-shell' : ''}${process.env.CONT_CALL === 'read' ? '-readctl' : ''}`;
L.openLog(name);
const st = process.env.ST ?? 'b';
const ws = `ws-${st}`;
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
let phase = 'A';
let heldResolve;
const held = new Promise((r) => (heldResolve = r));
const model = await L.startModel({
  cont: async ({ round, tools }) => {
    if (phase === 'A') {
      if (round === 0) return { calls: [['glob', { pattern: '**/*.ts' }]] };
      heldResolve();
      await new Promise(() => {}); // never answer: Harness A dies here
    }
    // phase B (continuation on Harness B): try glob again once, then finish.
    if (round === 1)
      return process.env.CONT_CALL === 'read'
        ? { calls: [['read_file', { file_path: 'src/a.ts' }]] }
        : { calls: [['glob', { pattern: 'src/*' }]] };
    return { text: `DONE continued; tools=${JSON.stringify(tools)}` };
  },
});
const proxy = await L.startBrokerProxy();
const LEASE = 10_000;
const A = await new L.Harness({ name: `s9a-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
let B;
try {
  const id = await L.createWorkspaceSession(ws, 'w');
  const sa = new L.HSession(A, id, { ...L.storeConnection(A, ws), leaseDurationMs: LEASE });
  L.say('create on A', `${PROFILE} -> ${(await sa.create({ toolProfile: PROFILE })).status}`);
  const sub = await sa.submit('[[S:cont]] find the ts files');
  L.say('submit on A', `${sub.status} promptId=${sub.promptId}`);
  await Promise.race([held, L.sleep(60_000)]);
  const before = model.requests.filter((q) => q.script === 'cont');
  L.say('A model rounds', JSON.stringify(before.map((q) => ({ round: q.round, tools: q.tools }))));
  A.child.kill('SIGKILL');
  L.say('A', 'SIGKILLed while the model round after the committed glob result was in flight');
  await L.sleep(LEASE + 3000);
  B = await new L.Harness({ name: `s9b-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
  phase = 'B';
  const sb = new L.HSession(B, id, { ...L.storeConnection(B, ws), leaseDurationMs: LEASE });
  let load;
  for (let i = 0; i < 12; i++) {
    load = await sb.load({ driveRuntimeRecovery: true });
    if (load.status !== 503) break;
    await L.sleep(5000);
  }
  const report = load.json?._meta?.['qwen.daemon.managedRuntimeRecovery'];
  L.say('takeover load on B', `${load.status} recoveryRequired=${load.json?.recoveryRequired} report=${JSON.stringify(report)?.slice(0, 300)}`);
  if (load.status === 200 && report) {
    const n = model.requests.length;
    const c = await B.json(`/session/${id}/managed-runtime/continue`, { promptId: sub.promptId, checkpointId: report.checkpointId, activationId: report.activationId }, { clientId: sb.clientId });
    L.say('continue', `${c.status} ${JSON.stringify(c.json)}`);
    const st2 = await sb.waitIdle(120_000);
    const events = (await sb.transcript()).filter((e) => e.promptId === sub.promptId);
    const after = model.requests.slice(n);
    L.say('continued model requests', JSON.stringify(after.map((q) => ({ round: q.round, tools: q.tools }))));
    for (const t of L.toolTrace(events, 300)) L.say('trace', t);
    L.say('terminal', JSON.stringify(events.filter((e) => e.type.startsWith('turn_')).map((e) => ({ type: e.type, data: e.data }))).slice(0, 400));
    L.say('status', JSON.stringify(st2));
    const advertised = after[0]?.tools ?? [];
    L.check(`continued request still advertises glob (${PROFILE})`, advertised.includes('glob'), JSON.stringify(advertised));
    L.check('continued Turn completes', events.some((e) => e.type === 'turn_complete'), JSON.stringify(events.filter((e) => e.type.startsWith('turn_')).map((e) => e.type)));
    L.say('harness B log', B.log().split('\n').filter((l) => /blocked|failed|refus|not advertised|unavailable/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ').slice(0, 600) || '<none>');
  }
} finally {
  await A.stop();
  await B?.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
