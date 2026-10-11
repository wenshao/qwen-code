// A deterministic materialization failure (one unreadable event row).
// Measure log cadence, isolation of a second Session, and the catch-up delay
// after the row is repaired.
export default async function (ctx) {
  await ctx.startSpring([...ctx.FAST_RETRY, '--qwen.managed-agent.events.materialize-interval=1h']);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] session A gets a poisoned event');
  await ctx.waitTurnTerminal(sid, 60000);
  await ctx.sleep(800);
  await ctx.stopSpring();
  const S = (id) => `tenant_id='retry-e2e' AND session_id=${ctx.q(id)}`;
  const victim = ctx.sql(`SELECT sequence_id FROM ${ctx.db}.managed_agent_event WHERE ${S(sid)} AND event_type='item.output_text.delta' ORDER BY sequence_id LIMIT 1`);
  const original = ctx.sql(`SELECT HEX(data_json) FROM ${ctx.db}.managed_agent_event WHERE ${S(sid)} AND sequence_id=${victim}`);
  ctx.sql(`UPDATE ${ctx.db}.managed_agent_event SET data_json='{not json' WHERE ${S(sid)} AND sequence_id=${victim}`);
  ctx.mark('poisoned', { victim });
  const progress = (id) => ctx.sql(`SELECT p.covered_sequence, s.last_sequence FROM ${ctx.db}.managed_agent_consumer_progress p JOIN ${ctx.db}.managed_agent_session s USING (tenant_id, session_id) WHERE p.tenant_id='retry-e2e' AND p.session_id=${ctx.q(id)}`).replace('\t', '/');
  await ctx.startSpring(ctx.FAST_RETRY);
  const tR = ctx.rel();
  // Session B at +60 s: does it materialize while A is stuck?
  while (ctx.rel() - tR < 60000) await ctx.sleep(500);
  const sidB = await ctx.createSession('[OK] healthy session B');
  await ctx.waitTurnTerminal(sidB, 60000);
  const tB = ctx.rel();
  let bCaughtUpMs = null;
  while (ctx.rel() - tB < 10000) { const [c, l] = progress(sidB).split('/'); if (c === l) { bCaughtUpMs = ctx.rel() - tB; break; } await ctx.sleep(100); }
  ctx.result.sessionB = { progress: progress(sidB), caughtUpMsAfterTerminal: bCaughtUpMs };
  // Repair A at +150 s and time the catch-up.
  while (ctx.rel() - tR < 150000) await ctx.sleep(500);
  ctx.sql(`UPDATE ${ctx.db}.managed_agent_event SET data_json=UNHEX('${original}') WHERE ${S(sid)} AND sequence_id=${victim}`);
  const tFix = ctx.rel();
  ctx.mark('repaired');
  let aCaughtUpMs = null;
  while (ctx.rel() - tFix < 75000) { const [c, l] = progress(sid).split('/'); if (c === l) { aCaughtUpMs = ctx.rel() - tFix; break; } await ctx.sleep(200); }
  ctx.result.sessionA = { progressEnd: progress(sid), caughtUpMsAfterRepair: aCaughtUpMs };
  // Log cadence (Spring timestamps), relative to the first failure.
  const ts = (l) => Date.parse(l.slice(0, 29));
  const fails = ctx.logLines('spring', /Failed to materialize Managed Agent session|projection is stuck/);
  const t0 = fails.length ? ts(fails[0]) : 0;
  ctx.result.failureLines = fails.length;
  ctx.result.stuckLines = fails.filter((l) => /projection is stuck/.test(l)).map((l) => `${((ts(l) - t0) / 1000).toFixed(1)}s ${l.replace(/.*MessageMaterializer\s+:\s*/, '').slice(0, 160)}`);
  ctx.result.failureOffsets = fails.map((l) => +((ts(l) - t0) / 1000).toFixed(1));
  ctx.result.springLogBytes = (await import('node:fs')).statSync(`${ctx.runDir}/spring.log`).size;
  ctx.mark('summary', { failureLines: ctx.result.failureLines, stuck: ctx.result.stuckLines, sessionB: ctx.result.sessionB, sessionA: ctx.result.sessionA });
}
