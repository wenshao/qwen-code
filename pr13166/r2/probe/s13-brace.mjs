// VERIFICATION RIG ONLY: S13 R4-3 — cost of a brace-heavy glob pattern on the real stack.
// A and B share Workspace X (ws-a); C is in Workspace Y (ws-c). Each Hosted Session has its own
// Runtime binding/worker on this provisioner (isolation_class=session).
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s13-brace-${L.ARM}`;
L.openLog(name);
for (const st of ['a', 'c']) {
  fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
  fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
  L.seedRegistry(`ws-${st}`, `st-${st}`);
}
const brace = (n) => ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '{a,b}'.repeat(n) + '/*' }]] } : { text: `DONE brace${n}` });
const model = await L.startModel({
  brace12: brace(12),
  brace13: brace(13),
  brace14: brace(14),
  read: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/a.ts' }]] } : { text: 'DONE read' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s13-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const session = async (st) => {
  const s = new L.HSession(h, await L.createWorkspaceSession(`ws-${st}`, 'w'), L.storeConnection(h, `ws-${st}`));
  await s.create({ toolProfile: 'hosted-workspace-files/2' });
  return s;
};
const timed = async (label, p) => {
  const t0 = Date.now();
  const r = await p;
  const resp = L.toolResponses(r.events ?? [])[0]?.response ?? {};
  L.say(label, `${L.summarizeTurn(r)} wall=${Date.now() - t0}ms result=${JSON.stringify(resp.output ?? resp.error ?? r.terminal?.[0]?.data ?? '').slice(0, 140)}`);
  return r;
};
try {
  const A = await session('a');
  const B = await session('a');
  const C = await session('c');
  await timed('A brace12 (62 B)', A.prompt('[[S:brace12]] go'));
  // brace13 with concurrent work in the same Workspace and in another Workspace.
  const a13 = timed('A brace13 (67 B)', A.prompt('[[S:brace13]] go', 600_000));
  await L.sleep(1500);
  const [b, c] = await Promise.all([timed('B read_file, same Workspace, during A', B.prompt('[[S:read]] go')), timed('C read_file, other Workspace, during A', C.prompt('[[S:read]] go'))]);
  await a13;
  // brace14 and a cancel 3 s in.
  const t0 = Date.now();
  const sub = await A.submit('[[S:brace14]] go');
  L.say('A brace14 (72 B)', `submitted ${sub.status}`);
  await L.sleep(3000);
  const cancel = await h.json(`/session/${A.sessionId}/cancel`, {}, { clientId: A.clientId });
  L.say('A cancel at 3 s', `${cancel.status} ${JSON.stringify(cancel.json ?? '')}`);
  const samples = [];
  for (;;) {
    const s = await A.status();
    const holder = L.holders().find((x) => x[1] !== '<none>');
    samples.push(`${Math.round((Date.now() - t0) / 1000)}s active=${s.hasActivePrompt} blocked=${s.recoveryBlocked} lease=${holder ? 'held' : 'free'}`);
    if (!s.hasActivePrompt || Date.now() - t0 > 600_000) break;
    if (samples.length === 4) {
      await timed('B read_file, same Workspace, during A brace14', B.prompt('[[S:read]] go'));
    }
    await L.sleep(5000);
  }
  L.say('A brace14 timeline', samples.join(' | '));
  const ev = (await A.transcript()).filter((e) => e.promptId === sub.promptId);
  L.say('A brace14 terminal', JSON.stringify(ev.filter((e) => e.type.startsWith('turn_')).map((e) => e.type)));
  L.say('A brace14 total', `${Date.now() - t0}ms; lease after: ${JSON.stringify(L.holders().filter((x) => x[1] !== '<none>'))}`);
  await timed('A next Turn after brace14', A.prompt('[[S:read]] go'));
  await timed('B after A finished', B.prompt('[[S:read]] go'));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
