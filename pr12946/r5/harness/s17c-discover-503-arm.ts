// S17c: same single 503 on the discover refresh, run against the tree given to run.sh (PR or candidate bundle).
import { Harness, effects, faults, fakeToolCall, mcpProfile, newSession, result, setScript, startBrokerProxy, startModel } from './rig12946-lib.js';
const W = Number(process.env['S17_WS'] ?? 1);
const model = await startModel(); const proxy = await startBrokerProxy(); const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { arm: process.env['ARM'] };
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('EFFECT')) { if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: ctx.marker }, 'e')] }; return { content: 'DONE' }; }
    return { content: 'TEXT_ONLY_ANSWER' };
  });
  const t = async (sid: string, m: string) => { const e0 = effects().length; const r = await h.prompt(sid, m, { timeout: 150_000 }); return { admit: r.admit.status, terminal: r.terminal?.map((x: any) => x.stopReason ?? x.type), blocked: r.status?.recoveryBlocked, effects: effects().length - e0 }; };
  const s = await newSession(W); const profile = mcpProfile(W, [['remote']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  out['warm'] = await t(s.sessionId, 'EFFECT_1');
  faults.push({ label: 'discover-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-discover"') });
  out['faultedTurn'] = await t(s.sessionId, 'TEXT_1');
  out['nextTurn'] = await t(s.sessionId, 'EFFECT_2');
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  const l = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['load'] = l.status;
  if (l.status === 200) { out['afterLoad'] = await t(s.sessionId, 'EFFECT_3'); out['finalDetach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status; }
} finally { result('s17c', out); await h.close(); await model.close(); await proxy.close(); }
