// R8 (PR 13109, review thread R1-1): the Broker process is replaced while a
// Session's MCP records are past the point where close() still acquires.
// Linux + durable local workers, so the restarted Broker can adopt the
// surviving worker (READY runtime Session row, empty in-memory map).
//   R8_FAULT=ownerundelivered  detach #1: the owner release is answered 503 by
//                              the proxy, not forwarded (records drained on the
//                              PR, releasing on base; Broker row stays READY)
//   R8_FAULT=none              no detach before the restart (control: acquire adopts)
//   R8_RESTART=0               no Broker restart (control)
// R8_RESPRING = shell command that SIGKILLs the Spring JVM and starts it again.
import { execFileSync } from 'node:child_process';
import {
  Harness, brokerCalls, brokerKinds, delay, faults, fakeToolCall, leaseRow, mcpProfile, mcpRecords, timeline,
  newSession, releaseCommits, result, runtimeSessions, setScript, startBrokerProxy, startModel,
  startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R8_WS'] ?? 0);
const FAULT = process.env['R8_FAULT'] ?? 'ownerundelivered';
const RESTART = process.env['R8_RESTART'] !== '0';
const SERVERS = (process.env['R8_SERVERS'] ?? 'remote').split(',');
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], fault: FAULT, restart: RESTART, servers: SERVERS.join(',') };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const workers = () => execFileSync('sh', ['-c', "ps -eo pid,ppid,stat,args | grep managed-runtime-worker | grep -v grep | awk '{print $1\":\"$2\":\"$3}'"]).toString().trim().split('\n').filter(Boolean);
const step = async (sessionId: string, n: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  const t = Date.now();
  let d: { status: number; json: any };
  try { d = await h.call(sessionId, `/session/${sessionId}/detach`, {}); } catch (e) { d = { status: 0, json: { code: String(e).slice(0, 80) } }; }
  return {
    n,
    status: code(d),
    ms: Date.now() - t,
    timeline: timeline(k, c),
    commits: releaseCommits(c),
    records: await mcpRecords(sessionId),
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
  const profile = mcpProfile(W, SERVERS.map((x) => [x] as [string]));
  out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const before: unknown[] = [];
  if (FAULT === 'ownerundelivered') {
    faults.push({ label: 'owner-release-503', action: '503', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
    before.push(await step(s.sessionId, 'before restart'));
  }
  out['beforeRestart'] = before;
  if (RESTART) {
    const w0 = workers();
    const t = Date.now();
    out['respring'] = execFileSync('sh', ['-c', process.env['R8_RESPRING']!]).toString().trim().split('\n').at(-1)?.slice(0, 60);
    out['brokerRestart'] = { workersBefore: w0, workersAfter: workers(), seconds: Number(((Date.now() - t) / 1000).toFixed(1)) };
  }
  if (process.env['R8_RELOAD_FIRST'] === '1') {
    // The Harness is replaced as well: a new writer loads the Session first.
    await h.close();
    await delay(65_000);
    h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
    out['reloadFirst'] = code(await h.open(s.sessionId, s.workspaceId, profile, 'load'));
  }
  const after: any[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await step(s.sessionId, `after restart #${i} (same Harness)`);
    after.push(r);
    if (r.status.startsWith('204') || r.status.startsWith('404')) break;
    await delay(3000);
  }
  if (!after.at(-1).status.startsWith('204')) {
    await h.close();
    await delay(65_000);
    h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
    const load = await h.open(s.sessionId, s.workspaceId, profile, 'load');
    out['reload'] = code(load);
    if (load.status === 200)
      for (let i = 1; i <= 2; i++) {
        const r = await step(s.sessionId, `after restart #${i} (new Harness)`);
        after.push(r);
        if (r.status.startsWith('204')) break;
        await delay(3000);
      }
  }
  // Is there a way out without a code change? A prompt makes the Harness
  // acquire the owner (which adopts the Session at the Broker); then detach.
  if (!after.at(-1).status.startsWith('204') && process.env['R8_PROMPT_ESCAPE'] === '1') {
    const k = brokerCalls.length;
    const p = await h.prompt(s.sessionId, 'ESCAPE_1', { timeout: 60_000 });
    out['promptWhileStuck'] = { admit: code(p.admit), terminal: p.terminal?.map((x: any) => x.stopReason ?? x.type), broker: brokerKinds(k), runtime: await runtimeSessions(W) };
    after.push(await step(s.sessionId, 'after that prompt'));
  }
  out['afterRestart'] = after;
  out['final'] = after.at(-1).status;
  out['workersAtEnd'] = workers();
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('r8', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
