export function opProbe(ctx, sid) {
  const S = `tenant_id='retry-e2e' AND session_id=${ctx.q(sid)}`;
  return () => {
    const op = ctx.sql(`SELECT operation_kind, state, delivery_state, attempt_count, IFNULL(error_code,'-'), admission_stage, IFNULL(receipt_id,'-') FROM ${ctx.db}.managed_agent_operation WHERE ${S} AND operation_kind IN ('CLOSE','DELETE') ORDER BY created_at`).split('\n').filter(Boolean).map((l) => l.split('\t').join('|'));
    const sess = ctx.sql(`SELECT status FROM ${ctx.db}.managed_agent_session WHERE ${S}`);
    const head = ctx.sql(`SELECT state, writer_generation, IF(writer_lease_until > CURRENT_TIMESTAMP(6), 'live', 'expired') FROM ${ctx.db}.qwen_managed_session_journal_head WHERE ${S}`).replaceAll('\t', '|');
    return { op, sess, head };
  };
}
export async function sample(ctx, probe, ms, every = 1000, until) {
  const out = [];
  const t0 = ctx.rel();
  let last = '';
  while (ctx.rel() - t0 < ms) {
    const p = probe();
    const s = JSON.stringify(p);
    if (s !== last) { out.push({ t: ctx.rel() - t0, ...p }); ctx.mark('probe', p); last = s; }
    if (until && until(p)) break;
    await ctx.sleep(every);
  }
  return out;
}
