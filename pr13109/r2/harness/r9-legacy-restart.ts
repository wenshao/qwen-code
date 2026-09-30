// R9 (review thread R2-1): an OLD writer (R9_OLD_CLI) detaches, the owner
// release succeeds at the Broker but its acknowledgement is lost, so the
// durable records stay `releasing` and the Broker row is RELEASED. Then:
//   R9_BREAK=restart  the Spring/Broker process is restarted (R9_RESPRING)
//   R9_BREAK=none     control
// A new Harness (RIG_HARNESS_CLI or this tree) loads the Session after the
// old writer lease and detaches. Each detach is bounded by the Harness's own
// 30 s Broker request timeout.
import { execFileSync } from 'node:child_process';
import {
  Harness, brokerCalls, brokerKinds, delay, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline,
  newSession, releaseCommits, result, runtimeSessions, setScript, startBrokerProxy, startModel,
  startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R9_WS'] ?? 0);
const BREAK = process.env['R9_BREAK'] ?? 'restart';
const OLD = process.env['R9_OLD_CLI']!;
const SERVERS = (process.env['R9_SERVERS'] ?? 'remote').split(',');
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url, cliPath: OLD });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], break: BREAK, servers: SERVERS.join(','), oldCli: OLD.split('/').slice(-3).join('/') };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const step = async (sessionId: string, n: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  const t = Date.now();
  let d: { status: number; json: any };
  try { d = await h.call(sessionId, `/session/${sessionId}/detach`, {}, 'POST', 200_000); } catch (e) { d = { status: 0, json: { code: String(e).slice(0, 80) } }; }
  return {
    n, status: code(d), seconds: Number(((Date.now() - t) / 1000).toFixed(1)),
    timeline: timeline(k, c), commits: releaseCommits(c), records: await mcpRecords(sessionId),
    holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free', runtime: await runtimeSessions(W),
  };
};
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, SERVERS.map((x) => [x] as [string]));
  out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  faults.push({ label: 'owner-release-ack-lost', action: 'drop-response', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
  out['oldWriter'] = await step(s.sessionId, 'old writer');
  await h.close();
  if (BREAK === 'restart') {
    const t = Date.now();
    out['respring'] = execFileSync('sh', ['-c', process.env['R9_RESPRING']!]).toString().trim().split('\n').at(-1)?.slice(0, 40);
    out['restartSeconds'] = Number(((Date.now() - t) / 1000).toFixed(1));
  }
  await delay(65_000);
  h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
  const k = brokerCalls.length;
  const load = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['load'] = { status: code(load), broker: brokerKinds(k) };
  const tries: any[] = [];
  if (load.status === 200)
    for (let i = 1; i <= 3; i++) {
      const r = await step(s.sessionId, `new writer #${i}`);
      tries.push(r);
      if (r.status.startsWith('204') || r.status.startsWith('404')) break;
      await delay(3000);
    }
  out['newWriter'] = tries;
  out['final'] = tries.at(-1)?.status;
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r9', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
