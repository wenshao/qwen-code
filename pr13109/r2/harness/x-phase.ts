// X (PR 13109): cross-host recovery. Phase A runs on one host: it opens a
// Session, runs a turn, detaches with a fault on the release path, and then
// SIGKILLs its Harness (the host "dies"). Phase B runs on another host after
// the writer lease expired: a new Harness loads the Session and detaches.
//   X_PHASE=A  X_CASE=undelivered|lostack|ownerundelivered|none   X_WS  X_SERVERS
//   X_PHASE=B  X_SESSION=<sessionId> X_WORKSPACE=<workspaceId>   X_WS  X_SERVERS  X_TRIES  X_EVERY_S
import { hostname } from 'node:os';
import {
  Harness, brokerCalls, delay, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline,
  newSession, releaseCommits, result, runtimeSessions, setScript, startBrokerProxy, startModel,
  startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const PHASE = process.env['X_PHASE'] ?? 'A';
const CASE = process.env['X_CASE'] ?? 'undelivered';
const W = Number(process.env['X_WS'] ?? 0);
const SERVERS = (process.env['X_SERVERS'] ?? 'remote').split(',');
const DESC: Record<string, string> = { remote: 'server http.', plain: 'server http2.', local: `server stdio-${W}.`, sticky: `server sticky-${W}.` };
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { phase: PHASE, case: CASE, host: hostname(), arm: process.env['ARM'], W, servers: SERVERS.join(','), harnessPid: h.cli.child?.pid };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const step = async (sessionId: string, n: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  const t = Date.now();
  let d: { status: number; json: any };
  try { d = await h.call(sessionId, `/session/${sessionId}/detach`, {}, 'POST', 200_000); } catch (e) { d = { status: 0, json: { code: String(e).slice(0, 80) } }; }
  return { n, releaseOps: brokerCalls.slice(k).filter((x) => x.kind === 'mcp-release').map((x) => x.opId), owners: [...new Set(brokerCalls.slice(k).map((x) => x.rsid).filter(Boolean))], at: new Date().toISOString(), status: code(d), seconds: Number(((Date.now() - t) / 1000).toFixed(1)), timeline: timeline(k, c), commits: releaseCommits(c), records: await mcpRecords(sessionId), holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free', runtime: await runtimeSessions(W) };
};
let killed = false;
try {
  setScript((ctx) => {
    const missing = SERVERS.filter((s) => !ctx.receipts.some((r) => JSON.stringify(r.content).includes(`EFFECT_OK:${DESC[s]!.replace('server ', '').replace(/\.$/, '')}:`)));
    if (ctx.receipts.length < SERVERS.length && missing.length) return { toolCalls: SERVERS.map((s, i) => fakeToolCall(ctx.tools.find((t) => t.description?.includes(DESC[s]!))!.name, { tag: `${ctx.marker}-${s}` }, `c${i}`)) };
    return { content: 'DONE' };
  });
  const profile = mcpProfile(W, SERVERS.map((x) => [x] as [string]));
  if (PHASE === 'A') {
    const s = await newSession(W);
    out['sessionId'] = s.sessionId;
    out['workspaceId'] = s.workspaceId;
    out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
    out['turn'] = (await h.prompt(s.sessionId, `XH_${s.sessionId.slice(0, 6)}`)).terminal?.map((x: any) => x.stopReason ?? x.type);
    if (CASE === 'undelivered') faults.push({ label: 'release-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-release"') });
    if (CASE === 'lostack') faults.push({ label: 'owner-release-ack-lost', action: 'drop-response', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
    if (CASE === 'ownerundelivered') faults.push({ label: 'owner-release-503', action: '503', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
    const d = await step(s.sessionId, 'phase A detach');
    out['detachA'] = d;
    if (!d.status.startsWith('204')) {
      // The host dies: no graceful shutdown of the Harness.
      process.kill(h.cli.child!.pid!, 'SIGKILL');
      killed = true;
      out['harnessKilledAt'] = new Date().toISOString();
    }
  } else {
    const sessionId = process.env['X_SESSION']!;
    const workspaceId = process.env['X_WORKSPACE']!;
    out['sessionId'] = sessionId;
    const load = await h.open(sessionId, workspaceId, profile, 'load');
    out['load'] = { at: new Date().toISOString(), status: code(load) };
    const tries: any[] = [];
    if (load.status === 200)
      for (let i = 1; i <= Number(process.env['X_TRIES'] ?? 4); i++) {
        const r = await step(sessionId, `phase B detach #${i}`);
        tries.push(r);
        if (r.status.startsWith('204') || r.status.startsWith('404')) break;
        await delay(Number(process.env['X_EVERY_S'] ?? 5) * 1000);
      }
    out['detachB'] = tries;
    out['final'] = tries.at(-1)?.status;
  }
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('x', out);
  if (!killed) await h.close();
  else await h.cli.close().catch(() => undefined);
  await model.close();
  await proxy.close();
  await store.close();
}
