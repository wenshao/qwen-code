// Same as seal-always but with production defaults: dispatch backoff 1 s -> 1 m,
// budget 10, writer lease 60 s.
import { opProbe, sample } from './close-common.mjs';
export default async function (ctx) {
  await ctx.startSpring([]);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] session to close with a permanently failing seal');
  ctx.result.sessionId = sid;
  await ctx.waitTurnTerminal(sid, 60000);
  const tStart = ctx.rel();
  ctx.storeTap.addFault({ id: 'seal503', method: 'POST', re: '/writers:seal$', status: 503 });
  const probe = opProbe(ctx, sid);
  await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k1' });
  ctx.result.samples = await sample(ctx, probe, 420000, 1000, (p) => /FAILED|COMPLETED/.test(p.op.join()));
  const rel = (o) => ((o.t - tStart) / 1000).toFixed(1);
  ctx.result.storeCalls = ctx.storeTap.observations.filter((o) => o.t >= tStart && /writers:(seal|renew)/.test(o.url)).map((o) => `${rel(o)}s ${o.url.replace(/.*\/sessions\/[^/]+/, '')} ${o.status}`);
  ctx.result.deletes = ctx.harnessTap.observations.filter((o) => o.method === 'DELETE').map((o) => `${rel(o)}s ${o.status}`);
  ctx.mark('summary', { last: ctx.result.samples.at(-1) });
}
