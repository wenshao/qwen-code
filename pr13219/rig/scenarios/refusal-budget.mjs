// Submission attempted (prompt 503), then Spring restarts so the next attempt
// must load the Session, and every load is refused with a named code.
export default async function (ctx) {
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  ctx.harnessTap.addFault({ id: 'prompt503', method: 'POST', re: '/prompt$', status: 503 });
  const sid = await ctx.createSession('[OK] admitted turn, then named load refusals');
  ctx.result.sessionId = sid;
  for (let i = 0; i < 100 && ctx.harnessTap.count((o) => /\/prompt$/.test(o.url)) < 1; i++) await ctx.sleep(100);
  await ctx.stopSpring();
  ctx.result.beforeRestart = { turns: ctx.turnRows(sid), submissionAttempted: ctx.sql(`SELECT submission_attempted FROM ${ctx.db}.managed_agent_turn WHERE session_id=${ctx.q(sid)}`) };
  ctx.harnessTap.addFault({ id: 'load-refused', method: 'POST', re: '/load$', status: 503, body: JSON.stringify({ code: 'managed_session_open_failed', message: 'injected named load refusal' }) });
  const t0 = ctx.rel();
  await ctx.startSpring(ctx.FAST_RETRY);
  const row = await ctx.waitTurnTerminal(sid, 60000);
  ctx.result.terminal = row ? { ...row, atMsAfterRestart: ctx.rel() - t0 } : null;
  ctx.result.afterWindow = ctx.turnRows(sid);
  ctx.result.requests = ctx.harnessTap.observations.filter((o) => o.method === 'POST').map((o) => `${o.method} ${o.url.replace(/[0-9a-f-]{36}/, 'SID')} ${o.status}`);
  ctx.result.publicTerminal = (await ctx.events(sid)).filter((e) => e.terminal).map((e) => ({ type: e.type, data: e.data }));
  ctx.result.springExhausted = ctx.logLines('spring', /exhausted retries/).map((l) => l.replace(/.*HarnessCoordinator\s+:\s*/, '').slice(0, 220));
  ctx.mark('summary', { terminal: ctx.result.terminal, pub: ctx.result.publicTerminal });
}
