// R2 (PR 13109): a stdio server whose stdout outlives the process (a
// grandchild `sleep 45` inherits it), so the release exceeds the Runtime's
// 5 s drain bound. Detach is retried every R2_EVERY_S seconds. For each try:
// status, Broker calls with the release operation state, whether the pipe
// holder is still alive, the Workspace holder.
// R2_RELOAD=1: after the first refused detach the Harness is stopped and a
// new one loads the Session once the old writer lease has expired.
import {
  Harness, alive, brokerCalls, brokerKinds, delay, fakeToolCall, leaseRow, ledger, mcpProfile, mcpRecords, timeline,
  newSession, releaseCommits, result, setScript, startBrokerProxy, startModel, startStoreProxy,
  storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R2_WS'] ?? 0);
const SERVERS = (process.env['R2_SERVERS'] ?? 'sticky').split(',');
const EVERY = Number(process.env['R2_EVERY_S'] ?? 8);
const TRIES = Number(process.env['R2_TRIES'] ?? 12);
const RELOAD = process.env['R2_RELOAD'] === '1';
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], servers: SERVERS.join(','), reload: RELOAD };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(`side effect on server sticky-${W}.`))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, SERVERS.map((x) => [x] as [string]));
  out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const mine = (e: Record<string, unknown>) => e['server'] === `sticky-${W}`;
  const grandchild = ledger().filter((e) => e['method'] === 'sticky-grandchild' && mine(e)).at(-1);
  const serverPid = Number(grandchild?.['pid'] ? ledger().filter((e) => e['method'] === 'process-start' && mine(e)).at(-1)?.['pid'] : 0);
  const gpid = Number(grandchild?.['pid']);
  const t0 = Number(grandchild?.['t'] ?? Date.now());
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  out['pipeHolderPid'] = gpid;
  const tries: unknown[] = [];
  let pipeClosedAt: number | null = null;
  const watch = setInterval(() => { if (pipeClosedAt === null && !alive(gpid)) pipeClosedAt = at(); }, 200);
  const httpDeletes = () => ledger().filter((e) => e['method'] === 'http-delete').length;
  const d0 = httpDeletes();
  for (let i = 1; i <= TRIES; i++) {
    const k = brokerCalls.length;
    const c = storeCalls.length;
    const started = at();
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    tries.push({
      n: i,
      at: `${started}s→${at()}s`,
      status: code(d),
      serverAlive: alive(serverPid),
      pipeHolderAlive: alive(gpid),
      broker: brokerKinds(k),
      releaseOps: brokerCalls.slice(k).filter((x) => x.kind === 'mcp-release').map((x) => `${x.opId?.slice(-20)}=${x.state}${x.code ? '/' + x.code : ''}`),
      commits: releaseCommits(c),
      timeline: timeline(k, c),
      records: await mcpRecords(s.sessionId),
      holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free',
      remoteClosed: httpDeletes() - d0,
    });
    if (d.status === 204 || d.status === 404) break;
    if (RELOAD && i === 1) {
      await h.close();
      await delay(65_000); // old writer lease (60 s)
      h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
      const load = await h.open(s.sessionId, s.workspaceId, profile, 'load');
      out['reload'] = { at: at(), load: code(load) };
      if (load.status !== 200) break;
      continue;
    }
    await delay(EVERY * 1000);
  }
  clearInterval(watch);
  out['pipeClosedAt'] = pipeClosedAt;
  out['tries'] = tries;
  out['final'] = (tries.at(-1) as any).status;
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r2', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
