import { loadSpec } from './spec-validator.mjs';
const h = loadSpec(process.argv[2]);
const SID = '7794b11a-8ae6-4e7a-9a4e-8bdee3e76cea';
const task = (x = {}) => ({ id: 't1', object: 'agent.task', session_id: SID, kind: 'background_shell', state: 'running', created_at: 1, started_at: 2, artifact_refs: [], action_capabilities: ['cancel', 'read_output'], ...x });
const ev = (x = {}) => ({ schema_version: 1, projection_version: 1, cursor: 'c1', task_id: 't1', session_id: SID, type: 'output', created_at: 1, text: 'x', ...x });
const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const cases = [
  ['PublicTask', 'id 128 chars', task({ id: 'a'.repeat(128) }), true],
  ['PublicTask', 'id 129 chars', task({ id: 'a'.repeat(129) }), false],
  ['PublicTask', 'id empty', task({ id: '' }), false],
  ['PublicTask', 'artifact_refs 100', task({ artifact_refs: arr(100, (i) => 'a' + i) }), true],
  ['PublicTask', 'artifact_refs 101', task({ artifact_refs: arr(101, (i) => 'a' + i) }), false],
  ['PublicTask', 'artifact_refs duplicate', task({ artifact_refs: ['a', 'a'] }), false],
  ['PublicTask', 'capability duplicate', task({ action_capabilities: ['cancel', 'cancel'] }), false],
  ['PublicTask', 'capability unknown', task({ action_capabilities: ['pause'] }), false],
  ['PublicTask', 'output_cursor 512', task({ output_cursor: 'c'.repeat(512) }), true],
  ['PublicTask', 'output_cursor 513', task({ output_cursor: 'c'.repeat(513) }), false],
  ['PublicTask', 'output_cursor empty', task({ output_cursor: '' }), false],
  ['PublicTask', 'definition_revision 0', task({ definition_revision: 0 }), false],
  ['PublicTask', 'definition_revision 1', task({ definition_revision: 1 }), true],
  ['PublicTask', 'kind unknown', task({ kind: 'team' }), false],
  ['PublicTask', 'runtime_state lost', task({ runtime_state: 'lost' }), true],
  ...['runtime_binding_id', 'generation', 'pid', 'runtime_endpoint', 'pod', 'path', 'secret_handle', 'sidecar', 'title'].map((k) => ['PublicTask', `forbidden field ${k}`, task({ [k]: k === 'generation' || k === 'pid' ? 1 : 'x' }), false]),
  ['PublicTask', 'recovery_blocked + cancel, no started_at', task({ state: 'recovery_blocked', started_at: undefined }), true],
  ['PublicTask', 'cancelled before start (no started_at)', task({ state: 'cancelled', started_at: undefined, settled_at: 3, action_capabilities: ['read_output'] }), true],
  ['PublicTaskEvent', 'text 16384', ev({ text: 'x'.repeat(16384) }), true],
  ['PublicTaskEvent', 'text 16385', ev({ text: 'x'.repeat(16385) }), false],
  ['PublicTaskEvent', 'text 16384 astral chars (32768 UTF-16 units)', ev({ text: '😀'.repeat(16384) }), true],
  ['PublicTaskEvent', 'output with empty text', ev({ text: '' }), false],
  ['PublicTaskEventList', 'next_cursor null', { object: 'list', data: [], has_more: false, next_cursor: null }, false],
  ['PublicTaskEventList', 'next_cursor absent', { object: 'list', data: [], has_more: false }, false],
  ['PublicTaskEventList', 'empty page with cursor', { object: 'list', data: [], has_more: false, next_cursor: 'c' }, true],
  ['PublicTaskEventList', '101 events', { object: 'list', data: arr(101, () => ev()), has_more: true, next_cursor: 'c' }, false],
  ['PublicTaskList', 'next_cursor null', { object: 'list', data: [], has_more: false, next_cursor: null }, true],
  ['WebShellTaskQueryRequest', 'cursor null', { sessionId: SID, cursor: null }, false],
  ['WebShellListRequest', 'cursor null (shipped sessions/query)', { cursor: null }, true],
  ['WebShellTaskQueryRequest', 'limit 0', { sessionId: SID, limit: 0 }, false],
  ['WebShellTaskQueryRequest', 'limit 101', { sessionId: SID, limit: 101 }, false],
  ['WebShellTaskEventQueryRequest', 'after empty', { sessionId: SID, taskId: 't1', after: '' }, false],
  ['WebShellTaskCancelRequest', 'with requestId', { sessionId: SID, taskId: 't1', idempotencyKey: 'k', requestId: 'r' }, false],
  ['WebShellCancelRequest', 'turn cancel with requestId (shipped)', { sessionId: SID, turnId: 'u1', idempotencyKey: 'k', requestId: 'r' }, true],
  ['WebShellTaskCancelRequest', 'missing idempotencyKey', { sessionId: SID, taskId: 't1' }, false],
];
let ok = 0; const rows = [];
for (const [schema, label, value, expect] of cases) {
  for (const k of Object.keys(value)) if (value[k] === undefined) delete value[k];
  const r = h.schema(schema, value);
  const pass = r.ok === expect; ok += pass;
  rows.push(`${pass ? 'PASS' : 'FAIL'}  ${schema.padEnd(30)} ${label.padEnd(48)} valid=${r.ok}`);
}
console.log(rows.join('\n')); console.log(`${ok}/${cases.length} as expected`);
