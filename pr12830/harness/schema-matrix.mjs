// Exhaustive schema matrix for the planned task contract, with an oracle
// written from the design note (sections 4.2 to 4.4), not from the schema.
import { loadSpec } from './spec-validator.mjs';
const head = loadSpec(process.argv[2]);
const STATES = ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'degraded', 'recovery_blocked'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const CAPS = ['cancel', 'send_input', 'read_output'];
const snakeToCamel = { id: 'taskId', session_id: 'sessionId', definition_revision: 'definitionRevision', runtime_state: 'runtimeState', created_at: 'createdAt', started_at: 'startedAt', settled_at: 'settledAt', output_cursor: 'outputCursor', artifact_refs: 'artifactRefs', action_capabilities: 'actionCapabilities', task_id: 'taskId', artifact_id: 'artifactId', next_cursor: 'nextCursor', has_more: 'hasMore' };
const camel = (o, top = true) => Array.isArray(o) ? o.map((x) => camel(x, false)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [snakeToCamel[k] ?? k, (k === 'artifact_refs' || k === 'action_capabilities') ? v : camel(v, false)])) : o;
const SID = '7794b11a-8ae6-4e7a-9a4e-8bdee3e76cea';
const rows = { taskMatrix: 0, taskMismatch: [], taskParity: [], eventMatrix: 0, eventMismatch: [], eventParity: [], cmdMatrix: 0, cmdMismatch: [], cmdParity: [], boundary: [] };
// 1. PublicTask: 8 states x started x settled x 8 capability subsets = 256
for (const state of STATES) for (const started of [0, 1]) for (const settled of [0, 1]) for (let mask = 0; mask < 8; mask++) {
  const caps = CAPS.filter((_, i) => mask & (1 << i));
  const t = { id: 't1', session_id: SID, kind: 'monitor', state, created_at: 1, artifact_refs: [], action_capabilities: caps };
  if (started) t.started_at = 2; if (settled) t.settled_at = 3;
  let expect = true;
  if (TERMINAL.has(state)) { if (!settled) expect = false; if (caps.includes('cancel') || caps.includes('send_input')) expect = false; }
  else if (settled) expect = false;
  if (['running', 'waiting', 'degraded'].includes(state) && !started) expect = false;
  if (state === 'pending' && started) expect = false;
  const pub = head.schema('PublicTask', t).ok, web = head.schema('WebShellTask', camel(t)).ok;
  rows.taskMatrix++;
  if (pub !== expect) rows.taskMismatch.push({ state, started, settled, caps, expect, pub });
  if (pub !== web) rows.taskParity.push({ state, started, settled, caps, pub, web });
}
// 2. PublicTaskEvent: 4 types x 2^5 optional-field subsets = 128
const OPT = { state: 'running', runtime_state: 'ready', text: 'x', truncated: true, artifact_id: 'a1' };
const allowed = { state_changed: { req: ['state'], ok: ['state', 'runtime_state'] }, output: { req: ['text'], ok: ['text', 'truncated'] }, artifact: { req: ['artifact_id'], ok: ['artifact_id'] } };
for (const type of ['state_changed', 'output', 'artifact', 'bogus']) for (let mask = 0; mask < 32; mask++) {
  const keys = Object.keys(OPT).filter((_, i) => mask & (1 << i));
  const e = { task_id: 't1', session_id: SID, type, created_at: 1 };
  for (const k of keys) e[k] = OPT[k];
  const a = allowed[type];
  const expect = !!a && a.req.every((k) => keys.includes(k)) && keys.every((k) => a.ok.includes(k));
  const pub = head.schema('PublicTaskEvent', e).ok, web = head.schema('WebShellTaskEvent', camel(e)).ok;
  rows.eventMatrix++;
  if (pub !== expect) rows.eventMismatch.push({ type, keys, expect, pub });
  if (pub !== web) rows.eventParity.push({ type, keys, pub, web });
}
// 3. Command operation: every type x task id present/absent, starting from a
//    minimal valid operation discovered from the schema itself.
const cmdSchema = head.spec.components.schemas.PublicCommandOperation;
const TYPES = cmdSchema.properties.type.enum;
export const cmd = { cmdSchemaRequired: cmdSchema.required, TYPES };
console.log(JSON.stringify(rows, null, 1));
