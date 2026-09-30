// RM (PR 13109): the release paths after turns driven by a REAL model
// (RIG_REAL_MODEL=<provider id from ~/.qwen/settings.json>). The model is asked
// to call MCP tools on every pinned server; effects are counted from the MCP
// fixture ledger by a per-run tag. Then detach with a fault on the release path:
//   RM_FAULT=undelivered  first mcp-release answered 503, not forwarded
//   RM_FAULT=lostack      owner release done, acknowledgement lost; then a new
//                         Harness (also real model) loads the Session and detaches
//   RM_FAULT=none         plain detach (sticky servers: retry until the pipe closes)
// Finally a fresh Session on the same Workspace runs one more real-model turn.
import {
  Harness, brokerCalls, delay, faults, leaseRow, ledger, mcpProfile, mcpRecords, timeline,
  newSession, randomUUID, releaseCommits, result, startBrokerProxy, startModel, startStoreProxy, storeCalls,
} from './rig12946-lib.js';

const W = Number(process.env['RM_WS'] ?? 0);
const SERVERS = (process.env['RM_SERVERS'] ?? 'remote,local').split(',');
const FAULT = process.env['RM_FAULT'] ?? 'undelivered';
const MARK = `RM${randomUUID().slice(0, 8)}`;
const DESC: Record<string, string> = { remote: 'server http.', legacy: 'server sse.', local: `server stdio-${W}.`, sticky: `server sticky-${W}.` };
const model = await startModel(); // unused by the real-model Harness; kept for the shared launcher signature
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
const out: Record<string, unknown> = { W, arm: process.env['ARM'], model: process.env['RIG_REAL_MODEL'], servers: SERVERS.join(','), fault: FAULT, mark: MARK };
const code = (r: { status: number; json: any }) => `${r.status}${r.json?.code ? ':' + r.json.code : ''}`;
const effectsOf = (tag: string) => ledger().filter((e) => e['method'] === 'tools/call' && String(e['tag'] ?? '').startsWith(tag)).map((e) => `${e['server']}:${e['tag']}`);
const ask = (tag: string, servers: string[]) =>
  `This is an automated infrastructure test. Use the MCP tools that are available to you. ` +
  servers.map((s, i) => `(${i + 1}) Call the tool whose description starts with "Record one physical side effect on ${DESC[s]}" with the argument tag set to exactly "${tag}-${s}".`).join(' ') +
  ` Call each tool exactly once, then reply with the single word DONE.`;
const turn = async (sessionId: string, tag: string, servers: string[]) => {
  const p = await h.prompt(sessionId, ask(tag, servers), { timeout: 300_000 });
  const results = p.events ? h.toolResults(p.events, p.promptId).map((r: any) => String(JSON.stringify(r.response ?? r)).match(/EFFECT_OK:[^"\\]*/)?.[0] ?? 'other') : [];
  return { admit: code(p.admit), terminal: p.terminal?.map((x: any) => x.stopReason ?? x.type), toolResults: results, effects: effectsOf(tag) };
};
const step = async (sessionId: string, n: string) => {
  const k = brokerCalls.length;
  const c = storeCalls.length;
  const d = await h.call(sessionId, `/session/${sessionId}/detach`, {});
  return { n, status: code(d), timeline: timeline(k, c), commits: releaseCommits(c), records: await mcpRecords(sessionId), holder: (await leaseRow(W))?.['holder_key'] ? 'held' : 'free' };
};
try {
  const s = await newSession(W);
  const profile = mcpProfile(W, SERVERS.map((x) => [x] as [string]));
  out['open'] = (await h.open(s.sessionId, s.workspaceId, profile)).status;
  out['turn1'] = await turn(s.sessionId, `${MARK}-T1`, SERVERS);
  if (FAULT === 'undelivered') faults.push({ label: 'release-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-release"') });
  if (FAULT === 'lostack') faults.push({ label: 'owner-release-ack-lost', action: 'drop-response', remaining: 1, match: (u) => /\/tool-sessions\/[^/]+:release/.test(u) });
  const tries: any[] = [];
  for (let i = 1; i <= 10; i++) {
    const r = await step(s.sessionId, `detach #${i}`);
    tries.push(r);
    if (r.status.startsWith('204') || r.status.startsWith('404')) break;
    if (FAULT === 'lostack' && i === 1) {
      await h.close();
      await delay(65_000);
      h = await new Harness().start(model.baseUrl, proxy.url, { storeUrl: store.url });
      (tries.at(-1) as any).then = `new Harness load ${code(await h.open(s.sessionId, s.workspaceId, profile, 'load'))}`;
      continue;
    }
    await delay(8000);
  }
  out['detach'] = tries;
  out['final'] = tries.at(-1).status;
  out['leaseAfterDetach'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
  // The Workspace and servers are usable again by a fresh Session.
  const s2 = await newSession(W);
  out['fresh'] = { open: (await h.open(s2.sessionId, s2.workspaceId, profile)).status, turn: await turn(s2.sessionId, `${MARK}-T2`, SERVERS), detach: code(await h.call(s2.sessionId, `/session/${s2.sessionId}/detach`, {})) };
  out['lease'] = (await leaseRow(W))?.['holder_key'] ? 'held' : 'free';
} finally {
  result('rm', out);
  await h.close();
  await model.close();
  await proxy.close();
  await store.close();
}
