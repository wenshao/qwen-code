// S3: a server-sent */list_changed notification. The Harness never dispatches
// mcp-discover; what happens to later calls in the same Session?
import {
  Harness, effects, fakeToolCall, mcpProfile, newSession, randomUUID, result,
  say, setScript, startBrokerProxy, startModel, toolFor,
} from './rig12946-lib.js';

const W = Number(process.env['S3_WS'] ?? 2);
const KIND = process.env['S3_KIND'] ?? 'resources';
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { kind: KIND };
try {
  const receipt = (ctx: any, i = 0) => String(JSON.stringify(ctx.receipts[i]?.content)).slice(0, 200);
  setScript((ctx) => {
    if (ctx.marker === 'NOTIFY') {
      if (ctx.receipts.length === 0)
        return { toolCalls: [fakeToolCall(toolFor(ctx, 'notification of the given kind from http.'), { kind: KIND }, 'n1')] };
      if (ctx.receipts.length === 1)
        return { toolCalls: [fakeToolCall(toolFor(ctx, 'server http.'), { tag: 'after-notify' }, 'e1')] };
      out['notifyReceipts'] = [receipt(ctx, 0), receipt(ctx, 1)];
      return { content: 'NOTIFY_DONE' };
    }
    if (ctx.marker === 'LATER') {
      if (ctx.receipts.length === 0)
        return { toolCalls: [fakeToolCall(toolFor(ctx, 'server http.'), { tag: 'later' }, 'e2')] };
      out[out['laterReceipt'] ? 'laterReceipt2' : 'laterReceipt'] = receipt(ctx);
      return { content: 'LATER_DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, [['remote']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  const e0 = effects().length;
  const n = await h.prompt(s.sessionId, 'NOTIFY');
  out['notifyTerminal'] = n.terminal;
  const later = await h.prompt(s.sessionId, 'LATER');
  out['laterTerminal'] = later.terminal;
  out['effectsAfterLater'] = effects().slice(e0).map((e) => `${e['name']}:${e['tag'] ?? e['kind'] ?? ''}`);
  const op = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, {
    operationId: randomUUID(), serverId: 'remote', request: { kind: 'prompt_get', name: 'two', arguments: { topic: 'x' } },
  });
  out['promptOpAfterNotify'] = { status: op.status, state: op.json?.state, error: op.json?.error };
  out['privateCatalog'] = (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => [c.catalogRevision, c.discovery]);
  out['effects'] = effects().slice(e0).map((e) => `${e['name']}:${e['tag'] ?? e['kind'] ?? ''}`);
  // Recovery path the design names: a new configuration revision.
  const conf = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/configurations`, {
    operationId: randomUUID(), expectedRevision: 1, server: profile.mcpServers[0],
  });
  out['reconfigure'] = { status: conf.status, body: conf.json };
  const after = await h.prompt(s.sessionId, 'LATER');
  out['afterReconfigure'] = { terminal: after.terminal, receipt: out['laterReceipt2'], effects: effects().slice(e0).map((e) => `${e['name']}:${e['tag'] ?? e['kind'] ?? ''}`) };
  say('detach', (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status);
} finally {
  result('s3', out);
  await h.close();
  await model.close();
  await proxy.close();
}
