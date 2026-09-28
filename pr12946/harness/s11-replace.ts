// S11: replace the 'local' stdio server revision 1 -> 2 while a tool call on
// revision 1 is in flight. The call must settle on its original connection;
// later turns must use revision 2.
import {
  Harness, delay, effects, fakeToolCall, ledger, mcpProfile, newSession, pin,
  randomUUID, result, say, setScript, startBrokerProxy, startModel, toolFor,
  waitUntil,
} from './rig12946-lib.js';

const W = Number(process.env['S11_WS'] ?? 2);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
const tag = `replace-${randomUUID().slice(0, 6)}`;
try {
  setScript((ctx) => {
    if (ctx.marker === 'SLOW') {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, `on server stdio-${W},`), { ms: 6000, tag }, 's')] };
      out['slowReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 140);
      return { content: 'SLOW_DONE' };
    }
    if (ctx.marker === 'AFTER') {
      if (!ctx.receipts.length) {
        out['afterAdvertisedServers'] = ctx.tools.filter((t) => t.description?.includes('side effect')).map((t) => t.description.replace(/.*server /, ''));
        return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect'))!.name, { tag: `${tag}-after` }, 'a')] };
      }
      out['afterReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 140);
      return { content: 'AFTER_DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['local']]));
  const run = h.prompt(s.sessionId, 'SLOW');
  await waitUntil(() => ledger().some((e) => e['tag'] === tag && e['phase'] === 'start'), 30_000);
  await delay(1000);
  const conf = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/configurations`, {
    operationId: randomUUID(), expectedRevision: 1, server: pin(W, 'local', 2),
  });
  out['replaceDuringCall'] = { status: conf.status, body: conf.json };
  const r = await run;
  out['slowTurn'] = r.terminal;
  out['slowPhases'] = ledger().filter((e) => e['tag'] === tag).map((e) => `${e['server']}:${e['phase']}`);
  const a = await h.prompt(s.sessionId, 'AFTER');
  out['afterTurn'] = a.terminal;
  out['catalog'] = (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => [c.serverId, c.serverRevision, c.configRevision, c.connectionGeneration]);
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
} finally {
  result('s11', out);
  await h.close();
  await model.close();
  await proxy.close();
}
