// S19 (round 6): R1-5 — a stdio server sends a duplicate reply for a request
// that already settled. Does the Runtime retire the connection (old) or
// ignore the stray reply (fixed)?
import {
  Harness, brokerCalls, delay, effects, fakeToolCall, ledger, mcpProfile,
  newSession, result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S19_WS'] ?? 1);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { arm: process.env['ARM'] };
const starts = () => ledger().filter((e) => e['method'] === 'process-start' && e['server'] === `stdio-${W}`).length;
try {
  setScript((ctx) => {
    if (ctx.marker === 'DUP') {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('duplicate reply'))!.name, {}, 'd')] };
      out['dupReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(-60);
      return { content: 'DUP_DONE' };
    }
    if (ctx.marker.startsWith('EFFECT')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(`side effect on server stdio-${W}.`))!.name, { tag: ctx.marker }, 'e')] };
      out[`${ctx.marker}_receipt`] = String(JSON.stringify(ctx.receipts[0].content)).slice(-60);
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['local']]));
  const gen = async () => (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => c.connectionGeneration);
  out['warm'] = (await h.prompt(s.sessionId, 'EFFECT_1')).terminal;
  out['genBefore'] = await gen();
  out['stdioStartsBefore'] = starts();
  const d = await h.prompt(s.sessionId, 'DUP');
  out['dupTurn'] = d.terminal;
  await delay(1500);
  out['duplicateSent'] = ledger().some((e) => e['method'] === 'dup-sent');
  const k = brokerCalls.length;
  const e0 = effects().length;
  out['next'] = (await h.prompt(s.sessionId, 'EFFECT_2')).terminal;
  out['nextEffects'] = effects().length - e0;
  out['configuresAfterDuplicate'] = brokerCalls.slice(k).filter((c) => c.kind === 'mcp-configure').length;
  out['genAfter'] = await gen();
  out['stdioStartsAfter'] = starts();
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
} finally {
  result('s19', out);
  await h.close();
  await model.close();
  await proxy.close();
}
