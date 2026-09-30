// S30 (round 9, R5-3): the stdio server sends raw notifications whose method
// is an Object.prototype member. Control: a real tools/list_changed.
import {
  Harness, brokerCalls, fakeToolCall, leaseHeld, mcpProfile, newSession, result,
  setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S30_WS'] ?? 3);
const METHODS = (process.env['S30_METHODS'] ?? 'toString,__proto__,constructor,hasOwnProperty,notifications/tools/list_changed').split(',');
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
let method = '';
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('RAW')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(`raw JSON-RPC notification with the given method from stdio-${W} `))!.name, { method }, 'r')] };
      return { content: 'SENT' };
    }
    if (ctx.marker.startsWith('WARM')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(`side effect on server stdio-${W}.`))!.name, { tag: ctx.marker }, 'e')] };
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['local']]));
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const catalog = async () => (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => `rev${c.configRevision}/cat${c.catalogRevision}/${Object.keys(c.discovery ?? {}).join('+')}`);
  out['catalog0'] = await catalog();
  let i = 0;
  for (const m of METHODS) {
    i++;
    method = m;
    const k = brokerCalls.length;
    const raw = await h.prompt(s.sessionId, `RAW_${i}`, { timeout: 90_000 });
    const text = await h.prompt(s.sessionId, `TEXT_${i}`, { timeout: 90_000 });
    out[`method:${m}`] = {
      rawTurn: raw.terminal?.map((x: any) => x.stopReason ?? x.type),
      textTurn: text.terminal?.map((x: any) => x.stopReason ?? x.type),
      configures: brokerCalls.slice(k).filter((c) => c.kind === 'mcp-configure').length,
      catalog: await catalog(),
      blocked: (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json?.recoveryBlocked,
    };
  }
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  out['lease'] = await leaseHeld(W);
} finally {
  result('s30', out);
  await h.close();
  await model.close();
  await proxy.close();
}
