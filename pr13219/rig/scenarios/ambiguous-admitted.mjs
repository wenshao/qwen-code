// The Harness admits the prompt but Spring only ever sees 503 (e.g. a proxy
// timing out after admission). Turn 1 keeps running in the Harness for 15 s.
export default async function (ctx) {
  ctx.slowMs = 15000;
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  ctx.harnessTap.addFault({ id: 'prompt-admitted-503', method: 'POST', re: '/prompt$', status: 503, mode: 'forward-fail' });
  const sid = await ctx.createSession('[SLOW] turn 1 admitted by the Harness, answered 503 to Spring');
  ctx.result.sessionId = sid;
  const t1 = await ctx.waitTurnTerminal(sid, 40000);
  ctx.result.turn1 = { ...t1, atMs: ctx.rel(), prompts: ctx.harnessTap.observations.filter((o) => /\/prompt$/.test(o.url)).map((o) => ({ t: o.t, upstream: o.upstream })) };
  ctx.harnessTap.clearFault('prompt-admitted-503');
  const fu = await ctx.followup(sid, '[OK] follow-up A right after turn 1 failed');
  const a = fu.status === 202 ? await ctx.waitTurnTerminal(sid, 60000) : null;
  ctx.result.followupA = { accepted: fu.status, row: a, atMs: ctx.rel() };
  while (ctx.rel() < 26000) await ctx.sleep(250);
  const fb = await ctx.followup(sid, '[OK] follow-up B after the orphaned Harness turn finished');
  const b = fb.status === 202 ? await ctx.waitTurnTerminal(sid, 60000) : null;
  ctx.result.followupB = { accepted: fb.status, row: b, atMs: ctx.rel() };
  ctx.result.turns = ctx.turnRows(sid);
  ctx.result.prompts = ctx.harnessTap.observations.filter((o) => /\/prompt$|\/status$/.test(o.url)).map((o) => `${o.t} ${o.method} ${o.url.replace(/[0-9a-f-]{36}/, 'SID')} ${o.status}${o.upstream ? ' upstream=' + o.upstream : ''}`);
  ctx.mark('summary', { turn1: ctx.result.turn1, followupA: ctx.result.followupA, followupB: ctx.result.followupB });
}
