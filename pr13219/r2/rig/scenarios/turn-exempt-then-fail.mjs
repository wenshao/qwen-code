// An exempt wait (409 hosted_turn_recovery_in_progress for 8 s) followed by
// charged failures (503). The budget must still allow its full 3 charged failures.
export default async function (ctx) {
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  ctx.harnessTap.addFault({ id: 'p409', method: 'POST', re: '/prompt$', status: 409, body: JSON.stringify({ error: 'hosted_turn_recovery_in_progress', code: 'hosted_turn_recovery_in_progress' }) });
  const sid = await ctx.createSession('[OK] turn: exempt wait, then charged failures');
  ctx.result.sessionId = sid;
  await ctx.sleep(8000);
  ctx.result.afterExemptWait = ctx.turnRows(sid);
  const before = ctx.harnessTap.count((o) => /\/prompt$/.test(o.url));
  ctx.harnessTap.clearFault('p409');
  ctx.harnessTap.addFault({ id: 'p503', method: 'POST', re: '/prompt$', status: 503 });
  const row = await ctx.waitTurnTerminal(sid, 30000);
  ctx.result.terminal = row;
  ctx.result.chargedPromptsAfterSwitch = ctx.harnessTap.count((o) => /\/prompt$/.test(o.url)) - before;
  ctx.mark('summary', { afterExemptWait: ctx.result.afterExemptWait, terminal: row, chargedPromptsAfterSwitch: ctx.result.chargedPromptsAfterSwitch });
}
