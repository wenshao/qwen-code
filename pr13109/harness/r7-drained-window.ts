// R7 (PR 13109): the window after the drain receipts are durable and the
// Broker released the owner, but the Harness never got the acknowledgement
// (records `drained`, Workspace holder already free, detach answered 503).
//   1. Session A in that window: a prompt and a raw MCP operation must be
//      refused without acquiring the Workspace again.
//   2. Session B (same Workspace) acquires the now-free Workspace.
//   3. A's detach retry replays only its own owner release; B's holder must
//      be untouched and B must keep working.
import {
  Harness, brokerCalls, brokerKinds, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline,
  newSession, randomUUID, releaseCommits, result, runtimeSessions, setScript, startBrokerProxy,
  startModel, startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R7_WS'] ?? 0);
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const hA = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const hB = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const mine = (from: number, rsid: string) => brokerCalls.slice(from).filter((c) => c.rsid === rsid || c.url.includes(rsid));
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const a = await newSession(W);
  const b = await newSession(W);
  const profile = mcpProfile(W, [['remote']]);
  await hA.open(a.sessionId, a.workspaceId, profile);
  out['A_warm'] = (await hA.prompt(a.sessionId, 'A1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const ownerA = String((await leaseRow(W))?.['runtime_session_id']);
  faults.push({ label: 'owner-release-ack-lost', action: 'drop-response', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
  let k = brokerCalls.length;
  let c = storeCalls.length;
  const d1 = await hA.call(a.sessionId, `/session/${a.sessionId}/detach`, {});
  out['A_detach1'] = { status: code(d1), timeline: timeline(k, c), records: await mcpRecords(a.sessionId), holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free', runtime: await runtimeSessions(W) };
  // 1. A in the drained window
  out['A_status'] = (await hA.call(a.sessionId, `/session/${a.sessionId}/status`)).json;
  k = brokerCalls.length;
  const p = await hA.prompt(a.sessionId, 'A2_IN_WINDOW', { timeout: 60_000 });
  const op = await hA.call(a.sessionId, `/session/${a.sessionId}/mcp/operations`, { operationId: randomUUID(), serverId: 'remote', request: { kind: 'resource_read', uri: 'mem://text' } });
  out['A_in_window'] = { prompt: code(p.admit), promptTerminal: p.terminal?.map((x: any) => x.stopReason ?? x.type), mcpOperation: code(op), broker: brokerKinds(k), holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free', records: await mcpRecords(a.sessionId) };
  // 2. B takes the free Workspace
  await hB.open(b.sessionId, b.workspaceId, profile);
  out['B_prompt'] = (await hB.prompt(b.sessionId, 'B1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const holderB = await leaseRow(W);
  out['holderIsB'] = holderB?.['runtime_session_id'] !== ownerA && !!holderB?.['holder_key'];
  // 3. A's detach retry
  k = brokerCalls.length;
  c = storeCalls.length;
  const d2 = await hA.call(a.sessionId, `/session/${a.sessionId}/detach`, {});
  const after = await leaseRow(W);
  out['A_detach2'] = {
    status: code(d2),
    brokerForA: mine(k, ownerA).map((x) => `${x.url.split('/').pop()!.replace(/^[^:]+:/, 'owner-')}:${x.status}`),
    timeline: timeline(k, c),
    commits: releaseCommits(c),
    records: await mcpRecords(a.sessionId),
    holderStillB: after?.['holder_key'] === holderB?.['holder_key'] && after?.['runtime_session_id'] === holderB?.['runtime_session_id'],
    runtime: await runtimeSessions(W),
  };
  out['B_prompt_after_A_detach'] = (await hB.prompt(b.sessionId, 'B2')).terminal?.map((x: any) => x.stopReason ?? x.type);
  out['B_detach'] = code(await hB.call(b.sessionId, `/session/${b.sessionId}/detach`, {}));
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r7', out);
  await hA.close();
  await hB.close();
  await model.close();
  await proxy.close();
  await store.close();
}
