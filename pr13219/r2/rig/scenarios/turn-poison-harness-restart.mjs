// A stale activePrompts entry (turn 1 ended on the post-admission budget),
// then the Harness restarts with a new boot id, then a follow-up.
export default async function (ctx) {
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  ctx.harnessTap.addFault({ id: 'prompt503', method: 'POST', re: '/prompt$', status: 503 });
  const sid = await ctx.createSession('[OK] turn 1 under a failing prompt endpoint');
  ctx.result.sessionId = sid;
  const t1 = await ctx.waitTurnTerminal(sid, 60000);
  ctx.result.turn1 = t1;
  ctx.harnessTap.clearFault('prompt503');
  await ctx.stopHarness('SIGKILL');
  await ctx.startHarness();
  const before = ctx.harnessTap.observations.length;
  const fu = await ctx.followup(sid, '[OK] follow-up A after the Harness restarted');
  const a = fu.status === 202 ? await ctx.waitTurnTerminal(sid, 60000) : null;
  ctx.result.followupA = { accepted: fu.status, row: a };
  ctx.result.requestsAfterRestart = ctx.harnessTap.observations.slice(before).filter((o) => o.method !== 'GET' || /status/.test(o.url)).map((o) => `${o.method} ${o.url.replace(/[0-9a-f-]{36}/, 'SID')} ${o.status}`);
  ctx.result.retryFailures = ctx.logLines('spring', /coordination will retry/).map((l) => (l.match(/turn=(turn_\w{6}).*failure=(.*)$/) ?? []).slice(1).join(' ').slice(0, 140));
  ctx.mark('summary', { turn1: t1, followupA: ctx.result.followupA, requests: ctx.result.requestsAfterRestart, retryFailures: ctx.result.retryFailures });
}
