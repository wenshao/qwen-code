// A 409 on /prompt with a given daemon code for `holdMs`, then cleared.
// hosted_turn_recovery_in_progress is budget-exempt; hosted_turn_recovery_required is not.
export default async function (ctx, code, holdMs = 15000) {
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  ctx.harnessTap.addFault({ id: 'prompt409', method: 'POST', re: '/prompt$', status: 409, body: JSON.stringify({ error: code, code }) });
  const sid = await ctx.createSession(`[OK] turn behind a 409 ${code}`);
  ctx.result.sessionId = sid;
  const t0 = ctx.rel();
  let row = null;
  while (ctx.rel() - t0 < holdMs) { const r = ctx.turnRows(sid).at(-1); if (r && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status)) { row = r; break; } await ctx.sleep(250); }
  ctx.result.duringFault = { terminal: row, atMs: row ? ctx.rel() - t0 : null, rows: ctx.turnRows(sid), prompts: ctx.harnessTap.count((o) => /\/prompt$/.test(o.url)) };
  ctx.harnessTap.clearFault('prompt409');
  const end = row ?? (await ctx.waitTurnTerminal(sid, 20000));
  ctx.result.final = { row: end, rows: ctx.turnRows(sid), public: (await ctx.events(sid)).filter((e) => e.terminal).map((e) => ({ type: e.type, data: e.data })) };
  ctx.mark('summary', { duringFault: ctx.result.duringFault, final: ctx.result.final });
}
