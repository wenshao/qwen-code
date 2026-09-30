// R5 (PR 13109): deployment-order skew. The rig's Spring (store + Broker)
// is the BASE build, which does not know `drained`; the Harness and the
// Runtime worker are this PR. A plain detach of a one-server Session.
// With R5_WAIT_FILE the script then waits until that file exists (the
// operator restarts Spring with the PR build on the same database) and
// retries detach with the same Harness.
import { existsSync } from 'node:fs';
import {
  Harness, brokerCalls, brokerKinds, delay, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline, newSession,
  releaseCommits, result, runtimeSessions, setScript, startBrokerProxy, startModel,
  startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R5_WS'] ?? 0);
const WAIT = process.env['R5_WAIT_FILE'];
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const step = async (sessionId: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  const d = await h.call(sessionId, `/session/${sessionId}/detach`, {});
  return {
    status: code(d),
    broker: brokerKinds(k),
    commits: releaseCommits(c),
      timeline: timeline(k, c),
    records: await mcpRecords(sessionId).catch((e) => [String(e).slice(0, 80)]),
    storeErrors: storeCalls.slice(c).filter((x) => x.status >= 400).map((x) => `${x.url}:${x.status} ${x.error ?? ''}`.trim().slice(0, 260)),
    holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free',
    runtime: await runtimeSessions(W),
  };
};
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, [['remote']]);
  out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const skew: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await step(s.sessionId);
    skew.push(r);
    if (r.status.startsWith('204')) break;
  }
  out['oldStore'] = skew;
  out['statusWhileStuck'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  result('r5-partial', out);
  if (WAIT) {
    console.log('WAITING_FOR_STORE_UPGRADE');
    while (!existsSync(WAIT)) await delay(1000);
    const after: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      let r: any;
      try { r = await step(s.sessionId); } catch (e) { r = { status: `error ${String(e).slice(0, 120)}` }; }
      after.push(r);
      if (String(r.status).startsWith('204') || String(r.status).startsWith('404')) break;
      await delay(3000);
    }
    out['newStoreSameHarness'] = after;
    if (!String((after.at(-1) as any).status).startsWith('204')) {
      // A fresh Harness after the old writer lease expired.
      await h.close();
      await delay(65_000);
      h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
      const load = await h.open(s.sessionId, s.workspaceId, profile, 'load');
      const fresh: unknown[] = [{ load: code(load) }];
      if (load.status === 200)
        for (let i = 0; i < 3; i++) {
          const r = await step(s.sessionId);
          fresh.push(r);
          if (r.status.startsWith('204')) break;
        }
      out['newStoreNewHarness'] = fresh;
    }
  }
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r5', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
