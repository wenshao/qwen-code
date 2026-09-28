// S10: (a) author-shaped replay: reload, Broker down, replay committed op,
// close -> expect zero Broker requests. (b) a Session whose first MCP
// install was refused (Workspace busy) has an undispatched configuration
// intent: can it be closed?
import {
  Harness, brokerCalls, effects, fakeToolCall, mcpProfile, newSession,
  randomUUID, result, setBrokerDown, setScript, startBrokerProxy, startModel,
  toolFor,
} from './rig12946-lib.js';

const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(toolFor(ctx, 'server http.'), { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  // (a)
  const s = await newSession(1);
  const profile = mcpProfile(1, [['remote']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  const opId = randomUUID();
  const op = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: opId, serverId: 'remote', request: { kind: 'prompt_get', name: 'two', arguments: { topic: 'replay' } } });
  out['op'] = op.json?.state;
  out['close1'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  out['reload'] = (await h.open(s.sessionId, s.workspaceId, profile, 'load')).status;
  setBrokerDown(true);
  const k = brokerCalls.length;
  const e0 = effects().length;
  const replay = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: opId, serverId: 'remote', request: { kind: 'prompt_get', name: 'two', arguments: { topic: 'replay' } } });
  const close = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['authorShape'] = { replay: replay.status, messages: replay.json?.response?.messages?.length, close: close.status, brokerRequests: brokerCalls.length - k, effects: effects().length - e0 };
  setBrokerDown(false);
  // (b) A holds workspace-1; B's first prompt is refused; can B be closed?
  const a = await newSession(1);
  const b = await newSession(1);
  const pa = mcpProfile(1, [['remote']]);
  await h.open(a.sessionId, a.workspaceId, pa);
  await h.open(b.sessionId, b.workspaceId, pa);
  out['A'] = (await h.prompt(a.sessionId, 'A1')).terminal;
  const bp = await h.prompt(b.sessionId, 'B1');
  out['B_prompt_while_A'] = bp.admit.status;
  out['B_status'] = (await h.call(b.sessionId, `/session/${b.sessionId}/status`)).json;
  out['B_detach_while_A'] = (await h.call(b.sessionId, `/session/${b.sessionId}/detach`, {})).status;
  out['A_detach'] = (await h.call(a.sessionId, `/session/${a.sessionId}/detach`, {})).status;
  out['B_detach_after_A_left'] = (await h.call(b.sessionId, `/session/${b.sessionId}/detach`, {})).status;
  const bp2 = await h.prompt(b.sessionId, 'B2');
  out['B_prompt_after_A_left'] = { admit: bp2.admit.status, terminal: bp2.terminal };
  out['B_detach_after_prompt'] = (await h.call(b.sessionId, `/session/${b.sessionId}/detach`, {})).status;
} finally {
  result('s10', out);
  await h.close();
  await model.close();
  await proxy.close();
}
