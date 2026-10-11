// Upgrade with work in flight: main (V64) accumulates retries on a CLOSE, an
// admitted Turn and an ACTION_RESPONSE; then the same DB is opened by head
// (V65 migration + backfill) with the faults still on.
import { opProbe } from './close-common.mjs';
export default async function (ctx) {
  ctx.setArm('base');
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION = '20s';
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_APPROVAL_MODE = 'default';
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT = '1800s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const A = await ctx.createSession('[OK] session A will be closed');
  await ctx.waitTurnTerminal(A, 60000);
  const C = await ctx.createSession('[WRITE] session C asks for approval', { workspace: true });
  let action;
  for (let i = 0; i < 120 && !action; i++) { action = (await ctx.api('GET', `/v1/agents/sessions/${C}/actions`)).json?.data?.[0]; if (!action) await ctx.sleep(250); }
  const detail = (await ctx.api('GET', `/v1/agents/sessions/${C}/actions/${action.id}`)).json;
  ctx.harnessTap.addFault({ id: 'prompt503', method: 'POST', re: '/prompt$', status: 503 });
  ctx.harnessTap.addFault({ id: 'delete503', method: 'DELETE', re: '^/session/', status: 503 });
  ctx.harnessTap.addFault({ id: 'resolve503', method: 'POST', re: '/actions/.*/resolve$', status: 503 });
  const B = await ctx.createSession('[OK] session B turn hits a failing prompt endpoint');
  const close = await ctx.api('POST', `/v1/agents/sessions/${A}/close`, {}, { 'idempotency-key': 'close-A' });
  const answer = await ctx.api('POST', `/v1/agents/sessions/${C}/actions/${action.id}/responses`, { kind: 'permission', input_revision: detail.input_revision ?? '1', policy_revision: detail.policy_revision ?? 'hosted-tool-approval/1', option_id: 'allow' }, { 'idempotency-key': 'answer-C' });
  ctx.result.sessions = { A, B, C, close: close.status, answer: answer.status };
  await ctx.sleep(15000);
  const ops = () => ctx.sql(`SELECT session_id, operation_kind, state, delivery_state, attempt_count, ${ctx.hasColumn('managed_agent_operation', 'budget_exempt_attempt') ? 'budget_exempt_attempt' : "'n/a'"}, IFNULL(error_code,'-') FROM ${ctx.db}.managed_agent_operation WHERE operation_kind IN ('CLOSE','ACTION_RESPONSE') ORDER BY created_at`).split('\n').map((l) => { const [sid, ...r] = l.split('\t'); return `${sid === A ? 'A' : sid === C ? 'C' : sid.slice(0, 8)}:${r.join('|')}`; });
  const turnB = () => ctx.turnRows(B).map((r) => `${r.status}|${r.code}|retry=${r.retries}${r.cf !== undefined ? `|cf=${r.cf}|exempt=${r.exempt}` : ''}`);
  ctx.result.beforeUpgrade = { ops: ops(), turnB: turnB(), flyway: ctx.sql(`SELECT MAX(CAST(version AS UNSIGNED)) FROM ${ctx.db}.flyway_schema_history WHERE success=1`) };
  ctx.mark('beforeUpgrade', ctx.result.beforeUpgrade);
  // Rolling upgrade: stop main, start head on the same database and dirs.
  await ctx.stopSpring();
  await ctx.stopHarness();
  ctx.setArm('head');
  await ctx.startSpring(ctx.FAST_RETRY);
  await ctx.startHarness();
  ctx.result.afterMigration = { ops: ops(), turnB: turnB(), flyway: ctx.sql(`SELECT CONCAT(version,' ',description,' ',success) FROM ${ctx.db}.flyway_schema_history WHERE version='65'`) };
  ctx.mark('afterMigration', ctx.result.afterMigration);
  const samples = [];
  const t0 = ctx.rel();
  let last = '';
  while (ctx.rel() - t0 < 45000) {
    const s = { ops: ops(), turnB: turnB() };
    const k = JSON.stringify(s);
    if (k !== last) { samples.push({ t: ctx.rel() - t0, ...s }); last = k; }
    await ctx.sleep(500);
  }
  ctx.result.afterUpgradeSamples = samples;
  ctx.result.final = samples.at(-1);
  ctx.mark('summary', { before: ctx.result.beforeUpgrade, afterMigration: ctx.result.afterMigration, final: ctx.result.final });
}
