// Round 2 matrix: oracle rewritten from the updated design note (4.2, 4.3), not from the schema.
import { loadSpec } from './spec-validator.mjs';
const h = loadSpec(process.argv[2]);
const STATES = ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'degraded', 'recovery_blocked'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const CAPS = ['cancel', 'send_input', 'read_output'];
const SID = '7794b11a-8ae6-4e7a-9a4e-8bdee3e76cea';
const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const web = (o, id = 'taskId') => Array.isArray(o) ? o.map((x) => web(x, id)) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'object').map(([k, v]) => [k === 'id' ? id : camelKey(k), (k === 'artifact_refs' || k === 'action_capabilities') ? v : web(v, id)])) : o;
const out = { task: [0, 0, 0], event: [0, 0, 0], list: [0, 0, 0], mismatches: [] };
const tally = (bucket, label, pubSchema, webSchema, inst, expect) => {
  const p = h.schema(pubSchema, inst).ok, w = h.schema(webSchema, web(inst)).ok;
  out[bucket][0]++; if (p === expect) out[bucket][1]++; else out.mismatches.push({ bucket, label, expect, pub: p });
  if (w === p) out[bucket][2]++; else out.mismatches.push({ bucket, label, parity: true, pub: p, web: w });
};
// PublicTask: 8 states x started x settled x 8 capability subsets
for (const state of STATES) for (const st of [0, 1]) for (const se of [0, 1]) for (let m = 0; m < 8; m++) {
  const caps = CAPS.filter((_, i) => m & (1 << i));
  const t = { id: 't1', object: 'agent.task', session_id: SID, kind: 'monitor', state, created_at: 1, artifact_refs: [], action_capabilities: caps };
  if (st) t.started_at = 2; if (se) t.settled_at = 3;
  let ok = true;
  if (TERMINAL.has(state)) { if (!se || caps.includes('cancel') || caps.includes('send_input')) ok = false; } else if (se) ok = false;
  if (['running', 'waiting', 'degraded', 'completed'].includes(state) && !st) ok = false;
  if (state === 'pending' && st) ok = false;
  if (state === 'recovery_blocked' && caps.includes('send_input')) ok = false;
  tally('task', `${state} st=${st} se=${se} caps=${caps}`, 'PublicTask', 'WebShellTask', t, ok);
}
// PublicTaskEvent: 3 known types + 1 later type x 2^5 optional fields
const OPT = { state: 'running', runtime_state: 'ready', text: 'x', truncated: true, artifact_id: 'a1' };
const allowed = { state_changed: { req: ['state'], ok: ['state', 'runtime_state'] }, output: { req: ['text'], ok: ['text', 'truncated'] }, artifact: { req: ['artifact_id'], ok: ['artifact_id'] } };
for (const type of ['state_changed', 'output', 'artifact', 'input_received']) for (let m = 0; m < 32; m++) {
  const keys = Object.keys(OPT).filter((_, i) => m & (1 << i));
  const e = { schema_version: 1, projection_version: 1, task_id: 't1', session_id: SID, type, cursor: 'c1', created_at: 1 };
  for (const k of keys) e[k] = OPT[k];
  const a = allowed[type];
  const ok = a ? a.req.every((k) => keys.includes(k)) && keys.every((k) => a.ok.includes(k)) : true; // later types: open (design 4.3)
  tally('event', `${type} ${keys}`, 'PublicTaskEvent', 'WebShellTaskEvent', e, ok);
}
// Lists: has_more x next_cursor {absent,null,"", "c"} for tasks and events
for (const kind of ['task', 'event']) for (const hm of [false, true]) for (const nc of ['absent', null, '', 'c']) {
  const l = { object: 'list', data: [], has_more: hm };
  if (nc !== 'absent') l.next_cursor = nc;
  const ok = kind === 'task' ? (nc === 'c' || (!hm && (nc === 'absent' || nc === null || nc === ''))) : nc === 'c';
  tally('list', `${kind} has_more=${hm} next_cursor=${nc}`, kind === 'task' ? 'PublicTaskList' : 'PublicTaskEventList', kind === 'task' ? 'WebShellTaskPage' : 'WebShellTaskEventPage', l, ok);
}
console.log(JSON.stringify(out, null, 1));
