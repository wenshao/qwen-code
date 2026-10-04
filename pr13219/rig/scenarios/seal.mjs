// Close an ACTIVE Session while the Session Store's seal endpoint fails.
import { opProbe, sample } from './close-common.mjs';
export default async function (ctx, times) {
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION = '20s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] session to close with a failing seal');
  ctx.result.sessionId = sid;
  await ctx.waitTurnTerminal(sid, 60000);
  const tStart = ctx.rel();
  ctx.storeTap.addFault({ id: 'seal503', method: 'POST', re: '/writers:seal$', status: 503, times });
  const probe = opProbe(ctx, sid);
  const close = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k1' });
  ctx.result.close = close.status;
  ctx.result.samples = await sample(ctx, probe, 100000, 500, (p) => p.sess === 'CLOSED' && /SEALED|expired/.test(p.head));
  ctx.result.closedAtMs = ctx.result.samples.find((s) => s.sess === 'CLOSED')?.t ?? null;
  const rel = (o) => ((o.t - tStart) / 1000).toFixed(1);
  ctx.result.storeCalls = ctx.storeTap.observations.filter((o) => o.t >= tStart && /writers:(seal|renew)|activation|release/.test(o.url)).map((o) => `${rel(o)}s ${o.url.replace(/.*\/sessions\/[^/]+/, '')} ${o.status}`);
  ctx.result.deletes = ctx.harnessTap.observations.filter((o) => o.method === 'DELETE').map((o) => `${rel(o)}s ${o.status}${o.errorBody ? ' ' + o.errorBody.slice(0, 80) : ''}`);
  ctx.result.harnessCloseErrors = ctx.logLines('harness', /close failed/).map((l) => l.slice(0, 220));
  ctx.mark('summary', { closedAtMs: ctx.result.closedAtMs, last: ctx.result.samples.at(-1) });
}
