// Stale boot: the Harness is SIGKILLed and restarted (new boot id) before the
// close is requested. Java's client still holds the old generation.
import { opProbe, sample } from './close-common.mjs';
export default async function (ctx) {
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION = '20s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] session to close after a Harness restart');
  ctx.result.sessionId = sid;
  await ctx.waitTurnTerminal(sid, 60000);
  await ctx.stopHarness('SIGKILL');
  await ctx.startHarness();
  const probe = opProbe(ctx, sid);
  const close = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k1' });
  ctx.result.close = close.status;
  ctx.result.samples = await sample(ctx, probe, 60000, 500, (p) => p.sess === 'CLOSED' || /FAILED/.test(p.op.join()));
  ctx.result.retryFailures = [...new Set(ctx.logLines('spring', /Managed Session operation will retry/).map((l) => (l.match(/failure=(\S+)/) ?? [])[1]))];
  ctx.result.deletes = ctx.harnessTap.observations.filter((o) => o.method === 'DELETE').map((o) => `${o.t} ${o.status}${o.errorBody ? ' ' + o.errorBody.slice(0, 60) : ''}`);
  ctx.mark('summary', { last: ctx.result.samples.at(-1), retryFailures: ctx.result.retryFailures });
}
