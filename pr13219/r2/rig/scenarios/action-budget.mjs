// An approval answer whose delivery keeps failing (resolve 503), then the
// fault clears. head: budget terminal + re-admission under the same key.
import fs from 'node:fs';
const findProbe = (dir) => { try { return fs.readdirSync(dir, { recursive: true }).some((p) => String(p).endsWith('retry-probe.txt')); } catch { return false; } };
export default async function (ctx) {
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_APPROVAL_MODE = 'default';
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT = '600s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[WRITE] write the probe file', { workspace: true });
  ctx.result.sessionId = sid;
  let action;
  for (let i = 0; i < 120 && !action; i++) { const r = await ctx.api('GET', `/v1/agents/sessions/${sid}/actions`); action = r.json?.data?.[0]; if (!action) await ctx.sleep(250); }
  if (!action) throw new Error('no action');
  const detail = (await ctx.api('GET', `/v1/agents/sessions/${sid}/actions/${action.id}`)).json;
  ctx.result.actionRequested = { id: action.id, state: detail.state ?? detail.status };
  ctx.harnessTap.addFault({ id: 'resolve503', method: 'POST', re: '/actions/.*/resolve$', status: 503 });
  const body = (option) => ({ kind: 'permission', input_revision: detail.input_revision ?? '1', policy_revision: detail.policy_revision ?? 'hosted-tool-approval/1', option_id: option });
  const respond = async (label, option, key = 'answer-k1') => {
    const r = await ctx.api('POST', `/v1/agents/sessions/${sid}/actions/${action.id}/responses`, body(option), { 'idempotency-key': key });
    const out = { label, status: r.status, body: r.json ?? r.text };
    ctx.mark('respond', out);
    (ctx.result.responds ??= []).push(out);
    return out;
  };
  const S = `tenant_id='retry-e2e' AND session_id=${ctx.q(sid)}`;
  const opRow = () => ctx.sql(`SELECT state, delivery_state, attempt_count, IFNULL(error_code,'-'), admission_stage, IF(receipt_id IS NULL,'-','rcpt') FROM ${ctx.db}.managed_agent_operation WHERE ${S} AND action_id IS NOT NULL`).replaceAll('\t', '|');
  const actionState = async () => (await ctx.api('GET', `/v1/agents/sessions/${sid}/actions/${action.id}`)).json?.state;
  const snap = async (label) => { const s = { label, t: ctx.rel(), op: opRow(), action: await actionState(), turn: ctx.turnRows(sid).map((r) => `${r.status}|${r.code}`).join(','), resolves: ctx.harnessTap.count((o) => /\/resolve$/.test(o.url)), file: findProbe(`${ctx.runDir}/tmp`) }; ctx.mark('snap', s); (ctx.result.snaps ??= []).push(s); return s; };
  await respond('first answer (resolve failing)', 'allow');
  for (let i = 0; i < 6; i++) { await ctx.sleep(2000); await snap(`fault +${(i + 1) * 2}s`); }
  await respond('same key, different option', 'deny');
  ctx.harnessTap.clearFault('resolve503');
  await ctx.sleep(8000);
  await snap('8s after the fault cleared, before any retry');
  await respond('caller retries same key + same body', 'allow');
  for (let i = 0; i < 10; i++) { await ctx.sleep(1000); const s = await snap(`retry +${i + 1}s`); if (/COMPLETED/.test(s.turn)) break; }
  ctx.result.publicOp = (ctx.result.responds[0].body?.id) ? (await ctx.api('GET', `/v1/agents/sessions/${sid}/operations/${ctx.result.responds[0].body.id}`)).json : null;
  ctx.mark('summary', { last: ctx.result.snaps.at(-1) });
}
