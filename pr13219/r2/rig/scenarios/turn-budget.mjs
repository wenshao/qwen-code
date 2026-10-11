// Admitted Turn whose /prompt keeps failing 503 (submission attempted, outcome
// unknown). head: terminal after max-post-admission-retries; base: no bound.
export default async function (ctx, opts = {}) {
  const fast = opts.defaultConfig ? [] : ctx.FAST_RETRY;
  const windowMs = opts.windowMs ?? 60000;
  await ctx.startSpring(fast);
  ctx.seedWorkspace();
  await ctx.startHarness();
  for (const f of opts.faults ?? [{ id: 'prompt503', method: 'POST', re: '/prompt$', status: 503 }]) ctx.harnessTap.addFault(f);
  const t0 = ctx.rel();
  const sid = await ctx.createSession('[OK] admitted turn under a failing prompt endpoint');
  ctx.result.sessionId = sid;
  const row = await ctx.waitTurnTerminal(sid, windowMs);
  ctx.result.terminal = row ? { ...row, atMs: ctx.rel() - t0 } : null;
  ctx.result.afterWindow = ctx.turnRows(sid);
  ctx.result.promptAttempts = ctx.harnessTap.count((o) => o.method === 'POST' && /\/prompt$/.test(o.url));
  ctx.result.loadAttempts = ctx.harnessTap.count((o) => o.method === 'POST' && /\/load$/.test(o.url));
  ctx.result.createAttempts = ctx.harnessTap.count((o) => o.method === 'POST' && /^\/session$/.test(o.url));
  ctx.result.publicTerminal = (await ctx.events(sid)).filter((e) => e.terminal).map((e) => ({ type: e.type, data: e.data }));
  ctx.result.springRetryLines = ctx.logLines('spring', /Managed Turn coordination will retry/).length;
  ctx.result.springExhausted = ctx.logLines('spring', /exhausted retries/).map((l) => l.slice(0, 300));
  // Clear the fault: is the Session usable again?
  for (const f of [...ctx.harnessTap.faults]) ctx.harnessTap.clearFault(f.id);
  const fu = await ctx.followup(sid, '[OK] follow-up after the fault cleared');
  ctx.result.followup = { status: fu.status, body: fu.text.slice(0, 300) };
  const second = await ctx.waitTurnTerminal(sid, 30000, fu.status === 202 ? -1 : 0);
  ctx.result.afterFollowup = ctx.turnRows(sid);
  ctx.mark('summary', { terminal: ctx.result.terminal, promptAttempts: ctx.result.promptAttempts, followup: fu.status, after: ctx.result.afterFollowup });
}
