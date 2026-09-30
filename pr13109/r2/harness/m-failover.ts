// M (PR 13109): two Broker instances on one host share the database and the
// durable worker state. The Session runs on B1. Detach #1 commits the drain
// receipt but its owner release is answered 503 by the proxy (not forwarded).
//   MF_MODE=failover  B1 is killed (MF_KILL), every later request goes to B2
//   MF_MODE=rr        B1 stays up, later requests alternate B2, B1, B2, ...
import { execFileSync } from 'node:child_process';
import {
  Harness, brokerCalls, delay, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline,
  newSession, releaseCommits, result, runtimeSessions, rig, setBrokerRoute, setScript, setStoreTarget, startBrokerProxy,
  startModel, startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['MF_WS'] ?? 0);
const MODE = process.env['MF_MODE'] ?? 'failover';
const B2 = process.env['RIG_BROKER_URL2']!;
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], mode: MODE };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const step = async (sessionId: string, n: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  let d: { status: number; json: any };
  try { d = await h.call(sessionId, `/session/${sessionId}/detach`, {}, 'POST', 200_000); } catch (e) { d = { status: 0, json: { code: String(e).slice(0, 80) } }; }
  return { n, status: code(d), timeline: timeline(k, c), commits: releaseCommits(c), records: await mcpRecords(sessionId), holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free', runtime: await runtimeSessions(W) };
};
try {
  setBrokerRoute(() => rig.brokerUrl);
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  out['open'] = (await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote']]))).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  faults.push({ label: 'owner-release-503', action: '503', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
  const tries: any[] = [await step(s.sessionId, 'detach #1 (B1)')];
  if (MODE === 'failover') {
    out['killB1'] = execFileSync('sh', ['-c', process.env['MF_KILL']!]).toString().trim().slice(0, 120);
    setBrokerRoute(() => B2);
    // B1 also served the store and the rig admin endpoint: move both to instance 2.
    setStoreTarget(process.env['MF_STORE2']!);
    rig.adminUrl = process.env['MF_ADMIN2']!;
  } else {
    let i = 0;
    setBrokerRoute(() => (i++ % 2 === 0 ? B2 : rig.brokerUrl));
  }
  for (let i = 2; i <= 5; i++) {
    const r = await step(s.sessionId, `detach #${i}`);
    tries.push(r);
    if (r.status.startsWith('204')) break;
    await delay(3000);
  }
  out['detach'] = tries;
  out['final'] = tries.at(-1).status;
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('mf', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
