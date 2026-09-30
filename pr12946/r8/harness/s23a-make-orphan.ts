// S23a (round 8): leave an MCP Session attached when the Harness exits
// (no detach), so S23 can check the orphaned Workspace lease.
import {
  Harness, fakeToolCall, leaseHeld, mcpProfile, newSession, result, setScript,
  startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S23_WS'] ?? 7);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W };
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote']]));
  const r = await h.prompt(s.sessionId, 'MCP_ORPHAN');
  out['turn'] = r.terminal?.map((x: any) => x.stopReason ?? x.type);
  out['sessionId'] = s.sessionId;
  out['leaseBeforeExit'] = await leaseHeld(W);
} finally {
  result('s23a', out);
  await h.close(); // Harness exits without detach
  await model.close();
  await proxy.close();
}
