// Message projection over a permanent event-sequence gap, on real MySQL.
// Phase 1 materializes nothing (interval 1h); the gap is cut with SQL while
// Spring is down; phase 2 runs the default 100 ms materializer.
export default async function (ctx, variant = 'mid') {
  const slow = ['--qwen.managed-agent.events.materialize-interval=1h'];
  await ctx.startSpring([...ctx.FAST_RETRY, ...slow]);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[MULTI] stream several deltas');
  ctx.result.sessionId = sid;
  const t1 = await ctx.waitTurnTerminal(sid, 60000);
  await ctx.sleep(1000);
  await ctx.stopSpring();
  const S = `tenant_id='retry-e2e' AND session_id=${ctx.q(sid)}`;
  const evs = ctx.sql(`SELECT sequence_id, event_type, IFNULL(turn_id,'') FROM ${ctx.db}.managed_agent_event WHERE ${S} ORDER BY sequence_id`).split('\n').map((l) => l.split('\t'));
  ctx.result.eventsBefore = evs.map(([s, t]) => `${s}:${t}`);
  const progress = () => ctx.sql(`SELECT p.covered_sequence, s.last_sequence FROM ${ctx.db}.managed_agent_consumer_progress p JOIN ${ctx.db}.managed_agent_session s USING (tenant_id, session_id) WHERE p.${S.replace(/ AND /, ' AND p.')}`);
  ctx.result.progressPhase1 = progress();
  let victims;
  if (variant === 'mid') {
    victims = evs.filter(([, t]) => t === 'turn.started' || t === 'environment.ready').map(([sq]) => sq);
  } else {
    victims = [evs.find(([, t]) => t === 'turn.completed')[0]];
  }
  ctx.sql(`DELETE FROM ${ctx.db}.managed_agent_event WHERE ${S} AND sequence_id IN (${victims.join(',')})`);
  ctx.result.deleted = victims;
  ctx.mark('gap.cut', { victims });
  await ctx.startSpring(ctx.FAST_RETRY);
  const tRestart = ctx.rel();
  if (variant === 'terminal') {
    await ctx.sleep(3000);
    ctx.result.progressBeforeFollowup = progress();
    const fu = await ctx.followup(sid, '[OK] follow-up appends events after the gap');
    ctx.result.followup = fu.status;
    await ctx.waitTurnTerminal(sid, 60000);
  }
  // Observe 20 s of the default materializer.
  const samples = [];
  while (ctx.rel() - tRestart < 20000) { samples.push(`${ctx.rel() - tRestart}:${progress()}`); await ctx.sleep(2000); }
  ctx.result.progressSamples = samples;
  ctx.result.progressEnd = progress();
  const items = await ctx.api('GET', `/v1/agents/sessions/${sid}/items`);
  ctx.result.itemsApi = { status: items.status, items: (items.json?.data ?? []).map((i) => ({ id: i.id, turn: i.turn_id, role: i.role, status: i.status, text: JSON.stringify(i.content ?? i.parts ?? '').slice(0, 120) })) };
  ctx.result.itemRows = ctx.sql(`SELECT item_id, item_role, item_status, last_sequence FROM ${ctx.db}.managed_agent_item WHERE ${S} ORDER BY first_sequence`).split('\n');
  ctx.result.turns = ctx.turnRows(sid);
  const lines = ctx.logLines('spring', /Failed to materialize|projection is stuck|skips a permanent event gap|Message projection event sequence has a gap/);
  ctx.result.logCounts = {
    failedToMaterialize: lines.filter((l) => /Failed to materialize/.test(l)).length,
    gapThrows: ctx.logLines('spring', /Message projection event sequence has a gap/).length,
    healLines: lines.filter((l) => /skips a permanent event gap/.test(l)).map((l) => l.replace(/.*ManagedAgentStore\s+:\s*/, '')),
    stuck: lines.filter((l) => /projection is stuck/.test(l)).length,
  };
  ctx.mark('summary', { progressEnd: ctx.result.progressEnd, logCounts: ctx.result.logCounts, items: ctx.result.itemRows });
}
