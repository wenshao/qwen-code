// A Turn that keeps making progress while its event stream keeps breaking:
// the model trickles 40 ticks over ~28 s; the tap cuts /events every 1.2 s.
export default async function (ctx) {
  ctx.trickleTicks = 40;
  ctx.trickleMs = 700;
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[TRICKLE] keep streaming while the stream keeps breaking');
  ctx.result.sessionId = sid;
  const t0 = ctx.rel();
  let cuts = 0;
  let row = null;
  const samples = [];
  while (ctx.rel() - t0 < 60000) {
    await ctx.sleep(ctx.cutEveryMs ?? 1200);
    const rows = ctx.turnRows(sid);
    samples.push({ t: ctx.rel() - t0, ...rows.at(-1) });
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(rows.at(-1)?.status)) { row = rows.at(-1); break; }
    cuts += ctx.harnessTap.dropActive('/events');
  }
  ctx.result.cuts = cuts;
  ctx.result.samples = samples;
  ctx.result.terminal = row ?? ctx.turnRows(sid).at(-1);
  ctx.result.items = (await ctx.api('GET', `/v1/agents/sessions/${sid}/items`)).json?.data?.map((i) => ({ role: i.role, status: i.status, text: JSON.stringify(i.content ?? '').slice(0, 80) }));
  ctx.mark('summary', { cuts, terminal: ctx.result.terminal, samples });
}
