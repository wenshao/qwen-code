// S17 (round 5): qqqys R1-2 — does one transient mcp-discover failure leave the
// Session permanently recovery-blocked? Faults are injected at the Broker proxy
// on the refresh that runs before the model request.
//   variant 503   : the discover control never reaches the Runtime
//   variant drop  : the Runtime handles it, the reply is lost
// Plus (e): 16 pins at capacity after list_changed -> does detach + load recover?
import {
  Harness, brokerCalls, effects, faults, fakeToolCall, mcpProfile, newSession,
  pin, result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
try {
  setScript((ctx) => {
    const effect = ctx.tools.find((t) => t.description?.includes('side effect on server http'));
    const notify = ctx.tools.find((t) => t.description?.includes('notification of the given kind from http2.'));
    if (ctx.marker.startsWith('EFFECT')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(effect!.name, { tag: ctx.marker }, 'e')] };
      return { content: 'DONE' };
    }
    if (ctx.marker.startsWith('NOTIFY')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(notify!.name, { kind: 'tools' }, 'n')] };
      return { content: 'NOTIFIED' };
    }
    return { content: 'TEXT_ONLY_ANSWER' };
  });
  const t = async (sid: string, marker: string) => {
    const e0 = effects().length;
    const r = await h.prompt(sid, marker, { timeout: 150_000 });
    return { admit: r.admit.status, admitBody: r.admit.status === 202 ? undefined : r.admit.json, terminal: r.terminal?.map((x: any) => x.stopReason ?? x.type), blocked: r.status?.recoveryBlocked, effects: effects().length - e0 };
  };
  for (const [variant, W, action] of [['503', 4, '503'], ['drop', 5, 'drop-response']] as const) {
    const s = await newSession(W);
    const profile = mcpProfile(W, [['remote']]);
    await h.open(s.sessionId, s.workspaceId, profile);
    const r: Record<string, unknown> = {};
    r['warm'] = await t(s.sessionId, `EFFECT_${variant}_1`);
    const k = brokerCalls.length;
    faults.push({ label: `discover-${variant}`, action: action as any, remaining: 1, match: (_u, b) => b.includes('"mcp-discover"') });
    r['faultedTurn'] = await t(s.sessionId, `TEXT_${variant}_1`);
    r['brokerDuringFault'] = brokerCalls.slice(k).filter((c) => c.kind).map((c) => `${c.kind}:${c.status}${c.fault ? '!' + c.fault : ''}`);
    r['status'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    r['nextTurn'] = await t(s.sessionId, `EFFECT_${variant}_2`);
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    r['detach'] = d.status;
    if (d.status === 204) {
      r['load'] = (await h.open(s.sessionId, s.workspaceId, profile, 'load')).status;
      r['afterLoad'] = await t(s.sessionId, `EFFECT_${variant}_3`);
      r['finalDetach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
    }
    out[variant] = r;
  }
  // (e) 16 pins at capacity + list_changed, then detach + load
  const W = 6;
  const s = await newSession(W);
  const prof = { toolProfile: 'hosted-workspace-mcp/1', mcpServers: Array.from({ length: 16 }, (_, i) => pin(W, `p${String(i).padStart(2, '0')}`)) };
  await h.open(s.sessionId, s.workspaceId, prof);
  const e: Record<string, unknown> = {};
  e['warm'] = await t(s.sessionId, 'EFFECT_e_1');
  e['notifyTurn'] = await t(s.sessionId, 'NOTIFY_e');
  e['text'] = await t(s.sessionId, 'TEXT_e');
  e['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  e['load'] = (await h.open(s.sessionId, s.workspaceId, prof, 'load')).status;
  e['afterLoadText'] = await t(s.sessionId, 'TEXT_e_2');
  e['afterLoadEffect'] = await t(s.sessionId, 'EFFECT_e_2');
  e['finalDetach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  out['e16_reload'] = e;
} finally {
  result('s17', out);
  await h.close();
  await model.close();
  await proxy.close();
}
