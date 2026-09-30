// S29 (round 9, R5-2): the first mcp-release never reaches the Runtime
// (the Broker proxy answers 503 without forwarding). Can detach recover?
import {
  Harness, brokerCalls, faults, fakeToolCall, leaseHeld, mcpProfile, newSession,
  result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S29_WS'] ?? 2);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? ''}`;
const kinds = (from: number) => brokerCalls.slice(from).map((c) => `${c.kind ?? c.url.split('/').pop()?.replace(/[0-9a-f-]{20,}/g, '<id>')}:${c.status}${c.fault ? '!' + c.fault : ''}${c.status >= 400 ? ' ' + (c.response ?? '').slice(0, 160) : ''}`);
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, (process.env['S29_SERVERS'] ?? 'remote').split(',').map((x) => [x] as [string])));
  out['servers'] = process.env['S29_SERVERS'] ?? 'remote';
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  faults.push({ label: 'release-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-release"') });
  for (let i = 1; i <= 3; i++) {
    const k = brokerCalls.length;
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    out[`detach${i}`] = { status: code(d), broker: kinds(k) };
    if (d.status === 204 || d.status === 404) break;
  }
  out['lease'] = await leaseHeld(W);
} finally {
  result('s29', out);
  await h.close();
  await model.close();
  await proxy.close();
}
