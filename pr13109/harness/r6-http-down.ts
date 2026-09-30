// R6 (PR 13109, regression): the Streamable HTTP MCP server is gone when the
// Session detaches (its process is stopped first), optionally next to a
// healthy second server. Does the release path still conclude?
// Uses the rig's dedicated `plain` server (http2) so other scenarios are not disturbed.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Harness, RUN, brokerCalls, delay, fakeToolCall, leaseRow, manifest, mcpProfile, mcpRecords, timeline,
  newSession, releaseCommits, result, setScript, startBrokerProxy, startModel, startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['R6_WS'] ?? 0);
const SERVERS = (process.env['R6_SERVERS'] ?? 'plain').split(',');
const model = await startModel();
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], servers: SERVERS.join(',') };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const plain = manifest.servers.find((s) => s.serverId === 'plain')!;
const port = new URL(plain.url!).port;
const sdk = manifest.servers.find((s) => s.env?.['RIG_SDK'])!.env!['RIG_SDK']!;
const pidFile = `${RUN}/srv-http2.pid`;
let restarted = false;
const restart = () => {
  const child = spawn(process.execPath, [`${process.env['RIG_DIR']}/mcp-server.mjs`, '--transport', 'http', '--port', port, '--name', 'http2', '--ledger', `${RUN}/ledger.jsonl`], { env: { ...process.env, RIG_SDK: sdk }, stdio: 'ignore', detached: true });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  restarted = true;
};
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('server http2.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  out['open'] = (await h.open(s.sessionId, s.workspaceId, mcpProfile(W, SERVERS.map((x) => [x] as [string])))).status;
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  process.kill(Number(readFileSync(pidFile, 'utf8').trim()));
  await delay(1500);
  const tries: unknown[] = [];
  for (let i = 1; i <= 3; i++) {
    const k = brokerCalls.length;
    const c = storeCalls.length;
    const t = Date.now();
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    tries.push({ n: i, status: code(d), ms: Date.now() - t, serverUp: restarted, commits: releaseCommits(c), timeline: timeline(k, c), records: await mcpRecords(s.sessionId), holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free' });
    if (d.status === 204 || d.status === 404) break;
    if (i === 2) { restart(); await delay(2000); }
    else await delay(3000);
  }
  out['tries'] = tries;
  out['final'] = (tries.at(-1) as any).status;
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  if (!restarted) restart();
  result('r6', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
