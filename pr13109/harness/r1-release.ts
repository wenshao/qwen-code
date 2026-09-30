// R1 (PR 13109): faults on the release path of a Hosted MCP Session, then
// detach retries. One script, several fault shapes (R1_FAULT):
//   undelivered  first mcp-release answered 503 by the Broker proxy, not forwarded
//   lostreply    first mcp-release forwarded, its reply dropped
//   ownerundelivered  owner release answered 503 by the proxy, not forwarded
//   lostack      owner release (tool-sessions/<id>:release) forwarded, its reply dropped
//   none         plain detach
// Optional R1_ACQUIRE=503|409other|reset : once every configuration is
// `releasing`, the next acquire is answered by the proxy with that fault.
import {
  Harness, brokerCalls, brokerKinds, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, newSession, timeline,
  releaseCommits, result, runtimeSessions, setScript, startBrokerProxy, startModel,
  startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R1_WS'] ?? 0);
const SERVERS = (process.env['R1_SERVERS'] ?? 'remote').split(',');
const FAULT = process.env['R1_FAULT'] ?? 'undelivered';
const ACQ = process.env['R1_ACQUIRE'] ?? '';
const NEEDLE: Record<string, string> = { remote: 'server http.', legacy: 'server sse.', local: `server stdio-${W}.`, plain: 'server http2.' };
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], servers: SERVERS.join(','), fault: FAULT, acquireFault: ACQ || undefined };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const isOwnerRelease = (u: string) => /\/tool-sessions\/[^/]+:release/.test(u);
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(NEEDLE[SERVERS[0]!]!))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  out['open'] = (await h.open(s.sessionId, s.workspaceId, mcpProfile(W, SERVERS.map((x) => [x] as [string])))).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  out['before'] = { holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free', runtime: await runtimeSessions(W) };
  if (FAULT === 'undelivered') faults.push({ label: 'release-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-release"') });
  if (FAULT === 'lostreply') faults.push({ label: 'release-reply-lost', action: 'drop-response', remaining: 1, match: (_u, b) => b.includes('"mcp-release"') });
  if (FAULT === 'ownerundelivered') faults.push({ label: 'owner-release-503', action: '503', remaining: 1, match: (u) => isOwnerRelease(u) });
  if (FAULT === 'lostack') faults.push({ label: 'owner-release-ack-lost', action: 'drop-response', remaining: 1, match: (u) => isOwnerRelease(u) });
  const detaches: unknown[] = [];
  for (let i = 1; i <= 4; i++) {
    const k = brokerCalls.length;
    const c = storeCalls.length;
    if (i === 2 && ACQ) {
      const match = (u: string) => u.includes('/tool-sessions:acquire');
      if (ACQ === '503') faults.push({ label: 'acquire-503', action: '503', remaining: 1, match });
      if (ACQ === 'reset') faults.push({ label: 'acquire-reset', action: 'reset', remaining: 1, match });
      if (ACQ === '409other') faults.push({ label: 'acquire-409-other', action: 'reply', remaining: 1, match, reply: { status: 409, body: { code: 'runtime_admission_closed', message: 'rig' } } });
    }
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    const row = await leaseRow(W);
    detaches.push({
      n: i,
      status: code(d),
      broker: brokerKinds(k),
      releaseOps: brokerCalls.slice(k).filter((x) => x.kind === 'mcp-release').map((x) => x.opId),
      owner: [...new Set(brokerCalls.slice(k).map((x) => x.rsid).filter(Boolean))],
      commits: releaseCommits(c),
      timeline: timeline(k, c),
      records: await mcpRecords(s.sessionId),
      holder: row?.['holder_key'] ? 'held' : 'free',
      runtime: await runtimeSessions(W),
    });
    if (d.status === 204 || d.status === 404) break;
  }
  out['detach'] = detaches;
  const ops = (detaches as any[]).flatMap((d) => d.releaseOps);
  out['sameReleaseIdentity'] = new Set(ops).size <= SERVERS.length;
  out['owners'] = [...new Set((detaches as any[]).flatMap((d) => d.owner))].length;
  out['final'] = (detaches.at(-1) as any).status;
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r1', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
