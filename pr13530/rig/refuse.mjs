// Reviewer plan 4 + the admission refusal matrix over real HTTP.
// usage: node refuse.mjs <db> [only-label-substring]
import { client, sql, sleep, modelLog, result, short } from './lib.mjs';

const [, , db, only] = process.argv;
const c = client(db);
const other = client(db, 'other-actor');
const run = Date.now().toString(36).slice(-5);
const f1 = { type: 'hosted_profile', profile: 'hosted-workspace-files/1' };
const f2 = { type: 'hosted_profile', profile: 'hosted-workspace-files/2' };
const base = { model: {}, instructions: '', tools: [f1], permission_policy: {} };
const big = (n) => 'x'.repeat(n);
// 65,536 UTF-8 bytes exactly: 21,845 three-byte chars + one ASCII byte.
const exact64k = '中'.repeat(21845) + 'a';
const sessionsOf = (agentId) => sql(db, `SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id='rig' AND agent_id='${agentId}'`);
const reqCount = (id) => modelLog((r) => r.id === id).length;

const cases = [
  // label, definition overrides, session options, expectation
  ['model not on Java allowlist', { model: { id: 'model-zzz' } }, {}, { status: 409, code: 'agent_definition_unsupported', field: 'model' }],
  ['model id empty', { model: { id: '' } }, {}, { status: 409, field: 'model' }],
  ['model with extra key', { model: { id: 'model-a', temperature: 0.2 } }, {}, { status: 409, field: 'model' }],
  ['model name instead of id', { model: { name: 'model-a' } }, {}, { status: 409, field: 'model' }],
  ['instructions 70 KiB', { instructions: big(70 * 1024) }, {}, { status: 409, field: 'instructions' }],
  ['instructions 65,537 bytes', { instructions: exact64k + 'b' }, {}, { status: 409, field: 'instructions' }],
  ['approval_mode plan', { permission_policy: { approval_mode: 'plan' } }, {}, { status: 409, field: 'permission_policy' }],
  ['approval_timeout_ms alone', { permission_policy: { approval_timeout_ms: 60000 } }, {}, { status: 409, field: 'permission_policy' }],
  ['approval_mode + approval_timeout_ms', { permission_policy: { approval_mode: 'default', approval_timeout_ms: 60000 } }, {}, { status: 409, field: 'permission_policy' }],
  ['bound Session with tools []', { tools: [] }, {}, { status: 409, field: 'tools' }],
  ['two profiles', { tools: [f1, f2] }, {}, { status: 409, field: 'tools' }],
  ['shell/1 not on allowlist', { tools: [{ type: 'hosted_profile', profile: 'hosted-workspace-shell/1' }], permission_policy: { approval_mode: 'default' } }, {}, { status: 409, field: 'tools' }],
  ['profile entry with extra key', { tools: [{ ...f2, extra: 1 }] }, {}, { status: 409, field: 'tools' }],
  ['skills non-empty', { skills: [{ name: 's' }] }, {}, { status: 409, field: 'skills' }],
  ['mcp_servers non-empty', { mcp_servers: [{ name: 'm' }] }, {}, { status: 409, field: 'mcp_servers' }],
  ['environment_template_id set', { environment_template_id: 'env-1' }, {}, { status: 409, field: 'environment_template_id' }],
  ['unbound Session selecting a profile', {}, { bound: false }, { status: 409, field: 'tools' }],
  ['explicit unknown revision 9', {}, { revision: '9' }, { status: 404, code: 'agent_not_found' }],
  ['metadata is ignored', { metadata: { anything: [1, 2, 3] } }, {}, { status: 202 }],
  ['skills/mcp_servers null and []', { skills: null, mcp_servers: [] }, {}, { status: 202 }],
];

for (const [label, over, opts, exp] of cases) {
  if (only && !label.includes(only)) continue;
  const a = await c.createAgent({ ...base, ...over });
  if (a.status !== 202) { result('refuse', label, false, `createAgent ${a.status} ${short(a.json)}`); continue; }
  const s = await c.createSession({ agentId: a.json.id, ...opts });
  const err = s.json?.error ?? {};
  const ok = s.status === exp.status && (!exp.code || err.code === exp.code) && (!exp.field || err.field === exp.field || err.details?.field === exp.field);
  const rows = sessionsOf(a.json.id);
  result('refuse', label, ok && (exp.status === 202 ? rows === '1' : rows === '0'),
    `${s.status} code=${err.code ?? '-'} field=${err.field ?? err.details?.field ?? '-'} rows=${rows} ${s.status !== 202 ? short(s.json) : ''}`);
}

if (!only || 'unknown agent'.includes(only)) {
  const s = await c.createSession({ agentId: `agent_${'0'.repeat(32)}` });
  result('refuse', 'unknown agent id', s.status === 404 && s.json?.error?.code === 'agent_not_found', `${s.status} ${short(s.json)}`);
  const a = await c.createAgent({ ...base, tools: [] });
  const x = await c.api('POST', '/v1/agents/sessions', { agent_id: a.json.id }, undefined);
  const headers = { 'x-qwen-tenant-id': 'other-tenant', 'x-rig-actor': 'rig-actor', 'content-type': 'application/json', 'idempotency-key': `k${run}` };
  const res = await fetch(`http://127.0.0.1:${c.st.springPort}/v1/agents/sessions`, { method: 'POST', headers, body: JSON.stringify({ agent_id: a.json.id }) });
  const body = await res.json().catch(() => ({}));
  result('refuse', 'other tenant cannot use the definition (404)', res.status === 404 && body?.error?.code === 'agent_not_found', `${res.status} ${short(body)}; same tenant unbound ${x.status}`);
  const q = await c.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', agent_revision: '2' });
  result('refuse', 'qwen-code with non-deployment revision still refused', q.status === 400, `${q.status} ${short(q.json)}`);
}

// Plan 4 second half: allowlisted models that the Harness cannot route.
for (const [label, model, unbound] of [
  ['allowlisted model whose key variable is unset', 'model-nocred'],
  ['allowlisted model configured twice (ambiguous)', 'model-dup'],
  ['allowlisted model absent from Harness modelProviders', 'model-ghost'],
  ['unbound model-only Session, model-nocred', 'model-nocred', true],
]) {
  if (only && !label.includes(only)) continue;
  const id = `p4${model.replace('model-', '')}${unbound ? 'u' : ''}${run}`;
  const a = await c.createAgent({ ...base, model: { id: model }, tools: unbound ? [] : [f1], instructions: `INSTR-P4-${run.toUpperCase()}` });
  const s = await c.createSession({ agentId: a.json.id, bound: !unbound, prompt: `D8::text::${id} hello` });
  if (s.status !== 202) { result('plan4', label, false, `create ${s.status} ${short(s.json)}`); continue; }
  const w = await c.waitTurn(s.json.id, { timeout: 90 });
  await sleep(500);
  const ev = await c.events(s.json.id);
  const failed = (ev.json?.data ?? []).filter((e) => /failed/.test(e.type));
  const codes = failed.map((e) => e.data?.code ?? e.data?.error?.code).join(',');
  const n = reqCount(id);
  const anyKey = modelLog((r) => r.id === id).map((r) => `${r.model}/${r.key}`).join(',');
  result('plan4', label, / FAILED model_unavailable/.test(w) && n === 0,
    `turn=${w} publicFailedCodes=${codes || '-'} inferenceRequests=${n} ${anyKey}`);
}

// Boundary: exactly 64 KiB of instructions is admitted and reaches the model.
if (!only || 'exact 64 KiB'.includes(only)) {
  const id = `p64k${run}`;
  const a = await c.createAgent({ ...base, model: { id: 'model-a' }, instructions: exact64k });
  const s = await c.createSession({ agentId: a.json.id, prompt: `D8::text::${id} hello` });
  const w = s.status === 202 ? await c.waitTurn(s.json.id, { timeout: 120 }) : `create ${s.status} ${short(s.json)}`;
  const r = modelLog((x) => x.id === id);
  result('boundary', 'exact 64 KiB (65,536 B) instructions admitted and delivered', / COMPLETED /.test(w + ' ') && r.length > 0 && r[0].sysLen > 21845, `${w} requests=${r.length} sysLen=${r[0]?.sysLen}`);
}
