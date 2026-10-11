// An admitted, running Turn (model streams for 60 s) whose event stream then
// keeps failing. head: before the terminal record, cancel the admitted Turn.
export default async function (ctx) {
  ctx.slowMs = 60000;
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[SLOW] long running turn');
  ctx.result.sessionId = sid;
  const S = `tenant_id='retry-e2e' AND session_id=${ctx.q(sid)}`;
  for (let i = 0; i < 120; i++) {
    const epoch = ctx.sql(`SELECT IFNULL(harness_event_epoch,'') FROM ${ctx.db}.managed_agent_turn WHERE ${S}`);
    if (epoch && ctx.modelLog.length > 0) break;
    await ctx.sleep(250);
  }
  ctx.result.admitted = { epochRecorded: !!ctx.sql(`SELECT IFNULL(harness_event_epoch,'') FROM ${ctx.db}.managed_agent_turn WHERE ${S}`), modelCalls: ctx.modelLog.length };
  const tBreak = ctx.rel();
  const fault = ctx.harnessTap.addFault({ id: 'events-reset', method: 'GET', re: '/events', mode: 'reset' });
  ctx.harnessTap.dropActive('/events');
  const row = await ctx.waitTurnTerminal(sid, 50000);
  const tTerminal = ctx.rel();
  ctx.result.terminal = row ? { ...row, msAfterBreak: tTerminal - tBreak } : null;
  ctx.result.eventsFaultHits = fault.hits;
  ctx.result.cancels = ctx.harnessTap.observations.filter((o) => o.method === 'POST' && /\/cancel$/.test(o.url)).map((o) => ({ msAfterBreak: o.t - tBreak, status: o.status }));
  const m = ctx.modelLog[0];
  ctx.result.model = { arrivedMsAfterBreak: m.t - tBreak, closedMsAfterBreak: m.closedAt != null ? m.closedAt - tBreak : null, completed: m.completed ?? null };
  ctx.harnessTap.clearFault('events-reset');
  const fu = await ctx.followup(sid, '[OK] follow-up after the terminal');
  const next = fu.status === 202 ? await ctx.waitTurnTerminal(sid, 40000) : null;
  ctx.result.followup = { accepted: fu.status, row: next };
  ctx.result.turns = ctx.turnRows(sid);
  ctx.result.modelAll = ctx.modelLog.map((e) => ({ t: e.t - tBreak, mode: e.mode, closed: e.closedAt != null ? e.closedAt - tBreak : null, completed: e.completed ?? null }));
  ctx.mark('summary', { admitted: ctx.result.admitted, terminal: ctx.result.terminal, cancels: ctx.result.cancels, model: ctx.result.model, followup: ctx.result.followup });
}
