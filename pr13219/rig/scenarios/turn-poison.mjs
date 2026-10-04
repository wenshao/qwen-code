// After a Turn ends terminally post-submission, do later Turns on the same
// Session reach the Harness? Then restart Spring only and try again.
export default async function (ctx, opts = {}) {
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const fault = opts.fault ?? { id: 'prompt503', method: 'POST', re: '/prompt$', status: 503 };
  ctx.harnessTap.addFault(fault);
  const sid = await ctx.createSession('[OK] turn 1 under a failing prompt endpoint');
  ctx.result.sessionId = sid;
  const prompts = () => ctx.harnessTap.count((o) => o.method === 'POST' && /\/prompt$/.test(o.url));
  const t1 = await ctx.waitTurnTerminal(sid, 60000);
  ctx.result.turn1 = { ...t1, promptRequests: prompts() };
  ctx.harnessTap.clearFault(fault.id);
  const steps = [];
  for (const label of ['A', 'B']) {
    const before = prompts();
    const fu = await ctx.followup(sid, `[OK] follow-up ${label} with a healthy Harness`);
    const row = fu.status === 202 ? await ctx.waitTurnTerminal(sid, 60000) : null;
    steps.push({ label, accepted: fu.status, row, promptRequestsSent: prompts() - before });
  }
  await ctx.stopSpring();
  await ctx.startSpring(ctx.FAST_RETRY);
  {
    const before = prompts();
    const fu = await ctx.followup(sid, '[OK] follow-up C after restarting Spring only');
    const row = fu.status === 202 ? await ctx.waitTurnTerminal(sid, 60000) : null;
    steps.push({ label: 'C (after Spring restart)', accepted: fu.status, row, promptRequestsSent: prompts() - before });
  }
  ctx.result.steps = steps;
  ctx.result.localRefusals = ctx.logLines('spring', /already has a running turn/).length;
  ctx.result.turns = ctx.turnRows(sid);
  ctx.mark('summary', { turn1: ctx.result.turn1, steps });
}
