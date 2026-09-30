// S31 (round 9): a stdio server whose stdout outlives the process (a
// grandchild keeps it open for ~45 s), so closing it exceeds the Runtime's
// 5 s drain bound. No replacement involved. Is detach recoverable once the
// pipe is finally closed?
import {
  Harness, delay, fakeToolCall, leaseHeld, ledger, mcpProfile, newSession,
  result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S31_WS'] ?? 5);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? ''}`;
try {
  setScript((ctx) => {
    if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes(`side effect on server sticky-${W}.`))!.name, { tag: ctx.marker }, 'e')] };
    return { content: 'DONE' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, (process.env['S31_SERVERS'] ?? 'sticky').split(',').map((x) => [x] as [string])));
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  const grandchild = ledger().filter((e) => e['method'] === 'sticky-grandchild' && e['server'] === `sticky-${W}`).at(-1);
  const t0 = Number(grandchild?.['t'] ?? Date.now());
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  out['grandchildPid'] = grandchild?.['pid'];
  const tries: string[] = [];
  for (let i = 0; i < Number(process.env['S31_TRIES'] ?? 8); i++) {
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    tries.push(`${code(d)}@${at()}s`);
    if (d.status === 204 || d.status === 404) break;
    await delay(15_000);
  }
  out['detachTries(sinceGrandchildStart)'] = tries;
  out['lease'] = await leaseHeld(W);
} finally {
  result('s31', out);
  await h.close();
  await model.close();
  await proxy.close();
}
