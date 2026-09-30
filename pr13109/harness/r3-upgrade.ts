// R3 (PR 13109): records written by an OLD writer (the base Harness CLI,
// R3_OLD_CLI), then the Session is loaded by the NEW Harness (this tree).
//   R3_MODE=lostack       old Harness: owner release succeeded, its reply was lost
//   R3_MODE=undelivered1  old Harness: first mcp-release undelivered, ONE detach (Broker still READY)
//   R3_MODE=fenced        old Harness: first mcp-release undelivered, TWO detaches
//                         (the old fast path asks the Broker to release while the
//                         connection is open: the owner is fenced, connection open)
// The SQL history is never edited; the old Harness is stopped and its writer
// lease (60 s) expires before the new Harness loads.
import {
  Harness, brokerCalls, brokerKinds, delay, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline, newSession,
  releaseCommits, result, runtimeSessions, setScript, startBrokerProxy, startModel, startStoreProxy,
  storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R3_WS'] ?? 0);
const MODE = process.env['R3_MODE'] ?? 'lostack';
const SERVERS = (process.env['R3_SERVERS'] ?? 'remote').split(',');
const OLD = process.env['R3_OLD_CLI']!;
const NEEDLE: Record<string, string> = { remote: 'server http.', legacy: 'server sse.', local: `server stdio-${W}.` };
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url, cliPath: OLD });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], mode: MODE, servers: SERVERS.join(','), oldCli: OLD.split('/').slice(-3).join('/') };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const step = async (sessionId: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  const d = await h.call(sessionId, `/session/${sessionId}/detach`, {});
  return {
    status: code(d),
    broker: brokerKinds(k),
    mcpControls: brokerCalls.slice(k).filter((x) => x.kind?.startsWith('mcp-') && x.kind !== 'mcp-status').map((x) => x.kind),
    owner: [...new Set(brokerCalls.slice(k).map((x) => x.rsid).filter(Boolean))],
    commits: releaseCommits(c),
      timeline: timeline(k, c),
    records: await mcpRecords(sessionId),
    holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free',
    runtime: await runtimeSessions(W),
  };
};
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(NEEDLE[SERVERS[0]!]!))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, SERVERS.map((x) => [x] as [string]));
  out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  if (MODE === 'lostack') faults.push({ label: 'owner-release-ack-lost', action: 'drop-response', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
  else faults.push({ label: 'release-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-release"') });
  const old: unknown[] = [await step(s.sessionId)];
  if (MODE === 'fenced') old.push(await step(s.sessionId));
  out['oldWriter'] = old;
  await h.close();
  const t = Date.now();
  await delay(65_000);
  h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
  const k = brokerCalls.length;
  const load = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['newWriterLoad'] = { afterS: Number(((Date.now() - t) / 1000).toFixed(0)), status: code(load), broker: brokerKinds(k) };
  const next: unknown[] = [];
  if (load.status === 200) {
    for (let i = 0; i < 3; i++) {
      const r = await step(s.sessionId);
      next.push(r);
      if (r.status.startsWith('204') || r.status.startsWith('404')) break;
    }
  }
  out['newWriter'] = next;
  out['final'] = (next.at(-1) as any)?.status;
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r3', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
