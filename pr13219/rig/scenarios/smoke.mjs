export default async function (ctx) {
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] smoke');
  const row = await ctx.waitTurnTerminal(sid, 60000);
  ctx.result.turn = row;
  ctx.result.events = (await ctx.events(sid)).map((e) => `${e.seq}:${e.type}`);
  ctx.result.cols = {
    turn: ctx.sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='${ctx.db}' AND table_name='managed_agent_turn' ORDER BY ordinal_position`).split('\n').join(','),
    op: ctx.sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='${ctx.db}' AND table_name='managed_agent_operation' ORDER BY ordinal_position`).split('\n').join(','),
    head: ctx.sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='${ctx.db}' AND table_name='qwen_managed_session_journal_head' ORDER BY ordinal_position`).split('\n').join(','),
    item: ctx.sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='${ctx.db}' AND table_name='managed_agent_item' ORDER BY ordinal_position`).split('\n').join(','),
  };
  console.log(JSON.stringify(ctx.result.cols, null, 1));
  console.log(ctx.result.events.join(' '));
}
