// S16 (round 5): the 16-connection admission cap and quota errors.
//   (a) 17 pins at creation -> 400 before any Broker traffic
//   (b) 16 pins at capacity: explicit reconfigure and a raw read
//   (c) at capacity, one server sends tools/list_changed: what do later turns do?
//   (d) control: 15 pins, same list_changed
import {
  Harness, brokerCalls, effects, fakeToolCall, newSession, pin, randomUUID,
  result, setScript, sql, startBrokerProxy, startModel,
  leaseHeld,
} from './rig12946-lib.js';

const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}`);
const profile = (W: number, n: number) => ({ toolProfile: 'hosted-workspace-mcp/1', mcpServers: ids(n).map((id) => pin(W, id)) });
try {
  setScript((ctx) => {
    const effect = ctx.tools.find((t) => t.description?.includes('side effect on server http2.'));
    const notify = ctx.tools.find((t) => t.description?.includes('notification of the given kind from http2.'));
    if (ctx.marker.startsWith('EFFECT')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(effect!.name, { tag: ctx.marker }, 'e')] };
      return { content: `DONE ${String(JSON.stringify(ctx.receipts[0].content)).slice(-50)}` };
    }
    if (ctx.marker.startsWith('NOTIFY')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(notify!.name, { kind: 'tools' }, 'n')] };
      return { content: 'NOTIFIED' };
    }
    return { content: 'TEXT_ONLY_ANSWER' };
  });
  // (a)
  const a = await newSession(1);
  const k = brokerCalls.length;
  const created = await h.open(a.sessionId, a.workspaceId, profile(1, 17));
  out['a_create17'] = { status: created.status, body: created.json, brokerCalls: brokerCalls.length - k };
  const t = async (sid: string, marker: string) => {
    const e0 = effects().length;
    const r = await h.prompt(sid, marker, { timeout: 150_000 });
    return { admit: r.admit.status, admitBody: r.admit.status === 202 ? undefined : r.admit.json, terminal: r.terminal?.map((x: any) => x.stopReason ?? x.type), blocked: r.status?.recoveryBlocked, effects: effects().length - e0 };
  };
  for (const [label, W, n] of [['b16', 2, 16], ['d15', 3, 15]] as const) {
    const s = await newSession(W);
    const opened = await h.open(s.sessionId, s.workspaceId, profile(W, n));
    const r: Record<string, unknown> = { create: opened.status };
    r['warm'] = await t(s.sessionId, `EFFECT_${label}_1`);
    r['configs'] = (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.length;
    const conf = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/configurations`, { operationId: randomUUID(), expectedRevision: 1, server: pin(W, 'p05') });
    r['explicitReconfigure'] = { status: conf.status, body: conf.json };
    const read = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: randomUUID(), serverId: 'p03', request: { kind: 'resource_read', uri: 'mem://text' } });
    r['rawRead'] = { status: read.status, state: read.json?.state, error: read.json?.error ?? read.json?.code };
    r['notifyTurn'] = await t(s.sessionId, `NOTIFY_${label}`);
    r['afterNotify_text'] = await t(s.sessionId, `TEXT_${label}_1`);
    r['afterNotify_effect'] = await t(s.sessionId, `EFFECT_${label}_2`);
    r['afterNotify_text2'] = await t(s.sessionId, `TEXT_${label}_2`);
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    r['detach'] = { status: d.status, body: d.json };
    r['lease'] = await leaseHeld(W);
    out[label] = r;
  }
} finally {
  result('s16', out);
  await h.close();
  await model.close();
  await proxy.close();
}
