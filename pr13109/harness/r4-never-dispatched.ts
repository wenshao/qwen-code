// R4 (PR 13109): a configuration that never dispatched. Session A (Harness
// hA) holds the Workspace; Session B (Harness hB, same pin) has its first
// install refused, so B only has a configuration intent. B's detach commits
// releasing → drained; the store proxy interrupts the `drained` commit
// (R4_FAULT=503: the store never sees it; drop-response: the store commits
// it and the reply is lost). A failed store write stops all further writes
// of that in-process Session, so the retry that matters is a reload: hB is
// stopped, and after its writer lease (60 s) a new Harness loads B and
// detaches it. B must close without acquiring the Workspace A still holds.
import {
  Harness, brokerCalls, brokerKinds, delay, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline, newSession,
  releaseCommits, result, setScript, startBrokerProxy, startModel, startStoreProxy,
  storeCalls, storeFaults,
} from './rig12946-lib.js';

const W = Number(process.env['R4_WS'] ?? 0);
const FAULT = (process.env['R4_FAULT'] ?? '503') as '503' | 'drop-response' | 'none';
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const hA = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
let hB = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], fault: FAULT };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const a = await newSession(W);
  const b = await newSession(W);
  const profile = mcpProfile(W, [['remote']]);
  await hA.open(a.sessionId, a.workspaceId, profile);
  await hB.open(b.sessionId, b.workspaceId, profile);
  out['A_prompt'] = (await hA.prompt(a.sessionId, 'A1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const holderA = (await leaseRow(W))?.['holder_key'];
  const bp = await hB.prompt(b.sessionId, 'B1');
  out['B_prompt_while_A_holds'] = code(bp.admit);
  out['B_records_before'] = await mcpRecords(b.sessionId);
  if (FAULT !== 'none')
    storeFaults.push({ label: `drained-commit-${FAULT}`, action: FAULT, remaining: 1, match: (u, d) => u.includes('/transactions:commit') && d.includes('"releaseState":"drained"') });
  const step = async (n: string) => {
    const k = brokerCalls.length;
    const c = storeCalls.length;
    const d = await hB.call(b.sessionId, `/session/${b.sessionId}/detach`, {});
    return {
      n,
      status: code(d),
      acquires: brokerCalls.slice(k).filter((x) => x.url.includes(':acquire')).length,
      commits: releaseCommits(c),
      timeline: timeline(k, c),
      records: await mcpRecords(b.sessionId),
      holderStillA: (await leaseRow(W))?.['holder_key'] === holderA,
    };
  };
  const tries: any[] = [await step('1')];
  if (!tries[0].status.startsWith('204')) {
    tries.push(await step('2 (same Harness)'));
    out['B_status_same_harness'] = (await hB.call(b.sessionId, `/session/${b.sessionId}/status`)).json;
    await hB.close();
    await delay(65_000);
    hB = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
    const k = brokerCalls.length;
    const load = await hB.open(b.sessionId, b.workspaceId, profile, 'load');
    out['B_reload'] = { status: code(load), broker: brokerKinds(k), records: await mcpRecords(b.sessionId) };
    if (load.status === 200) tries.push(await step('3 (new Harness)'));
  }
  out['B_detach'] = tries;
  out['final'] = tries.at(-1).status;
  out['A_detach'] = code(await hA.call(a.sessionId, `/session/${a.sessionId}/detach`, {}));
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r4', out);
  await hA.close();
  await hB.close();
  await model.close();
  await proxy.close();
  await store.close();
}
