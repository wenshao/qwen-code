// Harness alive (writer renewed) but its close endpoint fails 503 for 25 s.
import { opProbe, sample } from './close-common.mjs';
export default async function (ctx) {
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION = '20s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] session to close while the writer is live');
  ctx.result.sessionId = sid;
  await ctx.waitTurnTerminal(sid, 60000);
  ctx.harnessTap.addFault({ id: 'delete503', method: 'DELETE', re: '^/session/', status: 503 });
  const probe = opProbe(ctx, sid);
  const close = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k1' });
  ctx.result.close = { status: close.status };
  ctx.result.samples = await sample(ctx, probe, 25000, 500);
  ctx.harnessTap.clearFault('delete503');
  ctx.result.samplesAfterClear = await sample(ctx, probe, 15000, 300, (p) => p.sess === 'CLOSED');
  ctx.result.deletes = ctx.harnessTap.observations.filter((o) => o.method === 'DELETE').map((o) => o.status);
  ctx.mark('summary', { during: ctx.result.samples.at(-1), after: ctx.result.samplesAfterClear.at(-1) });
}
