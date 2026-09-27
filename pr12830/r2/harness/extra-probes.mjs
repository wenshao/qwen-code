// Instances aimed at the surviving mutants; prints how many flip on a given spec vs the original.
import { loadSpec } from './spec-validator.mjs';
const [orig, ...muts] = process.argv.slice(2);
const SID = '7794b11a-8ae6-4e7a-9a4e-8bdee3e76cea';
const task = (x = {}) => ({ id: 't1', object: 'agent.task', session_id: SID, kind: 'background_shell', state: 'running', created_at: 1, started_at: 2, artifact_refs: [], action_capabilities: [], ...x });
const ev = (x = {}) => ({ schema_version: 1, projection_version: 1, cursor: 'c1', task_id: 't1', session_id: SID, type: 'output', created_at: 1, text: 'x', ...x });
const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const P = [
  ['PublicTask', task({ artifact_refs: arr(101, (i) => 'a' + i) })], ['PublicTask', task({ artifact_refs: ['a', 'a'] })],
  ['PublicTask', task({ object: 'agent.session' })], ['PublicTask', task({ state: 'paused' })], ['PublicTask', task({ kind: 'team' })],
  ['PublicTask', task({ action_capabilities: ['pause'] })], ['PublicTaskEvent', ev({ text: 'x'.repeat(16385) })],
  ['PublicTaskEventList', { object: 'list', data: [], has_more: false }],
  ['PublicTaskEvent', ev({ type: 'artifact', text: undefined, artifact_id: 'a1', runtime_state: 'ready' })],
  ['PublicTaskEvent', ev({ artifact_id: 'a1' })], ['PublicTaskEvent', ev({ type: 'state_changed', text: undefined, state: 'running', artifact_id: 'a1' })],
  ['PublicTaskList', { object: 'page', data: [], has_more: false }], ['PublicTask', task({ output_cursor: 'c'.repeat(513) })],
  ['WebShellTaskQueryRequest', { sessionId: SID, limit: 101 }], ['PublicTaskEvent', ev({ type: '' , text: undefined})],
  ['PublicTaskList', { object: 'list', data: arr(101, () => task()), has_more: true, next_cursor: 'c' }], ['PublicTask', task({ definition_revision: 0 })],
];
for (const [, v] of P) for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
const o = loadSpec(orig);
const base = P.map(([s, v]) => o.schema(s, v).ok);
console.log('on original spec: invalid', base.filter((x) => !x).length, '/', P.length);
for (const m of muts) { const sp = loadSpec(m); const flips = P.filter(([s, v], i) => sp.schema(s, v).ok !== base[i]).length; console.log(m.split('/').pop(), 'flips', flips); }
