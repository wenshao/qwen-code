#!/usr/bin/env node
// Independent schema validation for PR #12998 (managed-agent task contract).
// Validates behavioral instances against the baseline (main) and updated (PR)
// OpenAPI schemas with Ajv (draft 2020-12, OpenAPI 3.1), then runs schema
// mutations that each must be caught by a behavioral assertion.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/root/git/qwen-code-pr12998/package.json');
const Ajv2020 = require('ajv/dist/2020').default;

const BASE = JSON.parse(readFileSync('/tmp/spec-main.json', 'utf8'));
const UPDATED = JSON.parse(
  readFileSync(
    '/root/git/qwen-code-pr12998/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json',
    'utf8',
  ),
);

const SESSION = '6f1c7d7e-3a4b-4c2d-9e8f-0123456789ab';

function compile(spec, name) {
  const ajv = new Ajv2020({
    strict: false,
    validateFormats: false,
    allErrors: false,
  });
  ajv.addSchema(spec, 'spec.json');
  return ajv.compile({ $ref: `spec.json#/components/schemas/${name}` });
}

// ---- instance builders (same shapes as PlannedTaskContractTest) ----
const operation = (type) => ({
  id: 'operation-1',
  session_id: SESSION,
  type,
  status: 'pending',
  admission_stage: 'java_durable',
  delivery_state: 'pending',
  replayed: false,
});
const cancel = (status, extra = {}) => ({
  ...operation('task_cancel'),
  task_id: 'task-1',
  status,
  ...extra,
});
const event = (type, extra = {}) => ({
  schema_version: 1,
  projection_version: 1,
  task_id: 'task-1',
  session_id: SESSION,
  type,
  cursor: 'cursor-1',
  created_at: 1,
  ...extra,
});
const task = (state, startedAt, settledAt, caps = [], extra = {}) => ({
  id: 'task-1',
  object: 'agent.task',
  session_id: SESSION,
  kind: 'background_shell',
  state,
  created_at: 1,
  ...(startedAt != null ? { started_at: startedAt } : {}),
  ...(settledAt != null ? { settled_at: settledAt } : {}),
  artifact_refs: [],
  action_capabilities: caps,
  ...extra,
});

const CAMEL = {
  session_id: 'sessionId',
  task_id: 'taskId',
  admission_stage: 'admissionStage',
  delivery_state: 'deliveryState',
  receipt_id: 'receiptId',
  failure_code: 'failureCode',
  action_resolution: 'actionResolution',
  schema_version: 'schemaVersion',
  projection_version: 'projectionVersion',
  created_at: 'createdAt',
  started_at: 'startedAt',
  settled_at: 'settledAt',
  output_cursor: 'outputCursor',
  artifact_refs: 'artifactRefs',
  action_capabilities: 'actionCapabilities',
  artifact_id: 'artifactId',
  runtime_state: 'runtimeState',
  next_cursor: 'nextCursor',
  has_more: 'hasMore',
};
const camelize = (v, kind) => {
  if (Array.isArray(v)) return v.map((x) => camelize(x, kind));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (kind === 'task' && k === 'object') continue; // WebShellTask has no object
      let key = CAMEL[k] ?? k;
      if (k === 'id') {
        if (kind === 'operation') key = 'operationId';
        else if (kind === 'task') key = 'taskId';
      }
      out[key] = camelize(x, kind);
    }
    return out;
  }
  return v;
};
const MIRROR = {
  PublicTask: 'WebShellTask',
  PublicTaskList: 'WebShellTaskPage',
  PublicTaskEvent: 'WebShellTaskEvent',
  PublicTaskEventList: 'WebShellTaskEventPage',
  PublicCommandOperation: 'WebShellCommandOperation',
  PublicOperation: 'WebShellOperation',
};

// expect: [baseline, updated]
const checks = [];
const check = (schema, label, instance, baseline, updated = baseline) =>
  checks.push({ schema, label, instance, baseline, updated });

const OPS = ['PublicCommandOperation', 'PublicOperation'];
for (const s of OPS) {
  check(s, 'task_cancel pending', cancel('pending'), true);
  check(s, 'task_cancel running', cancel('running'), true);
  check(
    s,
    'recovery_blocked task_cancel stops delivery',
    cancel('recovery_blocked', { delivery_state: 'blocked' }),
    true,
  );
  check(
    s,
    'recovery_blocked task_cancel still pending',
    cancel('recovery_blocked'),
    true,
    false,
  );
  const completed = cancel('completed', {
    admission_stage: 'harness_confirmed',
    delivery_state: 'confirmed',
    receipt_id: 'receipt-1',
  });
  check(s, 'recorded task_cancel', completed, true);
  const noReceipt = { ...completed };
  delete noReceipt.receipt_id;
  check(s, 'completed task_cancel without receipt', noReceipt, false);
  check(
    s,
    'completed task_cancel still java_durable',
    cancel('completed', {
      delivery_state: 'confirmed',
      receipt_id: 'receipt-1',
    }),
    true,
    false,
  );
  check(
    s,
    'completed task_cancel still unconfirmed',
    cancel('completed', {
      admission_stage: 'harness_confirmed',
      receipt_id: 'receipt-1',
    }),
    true,
    false,
  );
  const failed = cancel('failed', {
    delivery_state: 'blocked',
    failure_code: 'task_action_unavailable',
  });
  check(s, 'definitively failed task_cancel', failed, true);
  check(
    s,
    'failed task_cancel still pending delivery',
    { ...failed, delivery_state: 'pending' },
    true,
    false,
  );
  check(
    s,
    'failed task_cancel without reason',
    (() => {
      const f = { ...failed };
      delete f.failure_code;
      return f;
    })(),
    true,
    false,
  );
  check(
    s,
    'failed task_cancel confirmed admission',
    { ...failed, admission_stage: 'harness_confirmed', receipt_id: 'receipt-1' },
    true,
    false,
  );
  check(s, 'task_cancel cannot itself be cancelled', cancel('cancelled'), true, false);
  check(
    s,
    'another command keeps its status shape',
    { ...operation('submit_input'), status: 'cancelled' },
    true,
  );
  check(
    s,
    'another command may fail without a code',
    { ...operation('submit_input'), status: 'failed' },
    true,
  );
}
// WebShell mirrors (camelCase), key cancel checks on both union surfaces
for (const s of ['WebShellCommandOperation', 'WebShellOperation']) {
  check(s, 'mirror: recorded task_cancel', camelize(cancel('completed', {
    admission_stage: 'harness_confirmed',
    delivery_state: 'confirmed',
    receipt_id: 'receipt-1',
  }), 'operation'), true);
  check(s, 'mirror: task_cancel cancelled', camelize(cancel('cancelled'), 'operation'), true, false);
  check(s, 'mirror: failed without reason', camelize(cancel('failed', {
    delivery_state: 'blocked',
  }), 'operation'), true, false);
  check(s, 'mirror: definitively failed', camelize(cancel('failed', {
    delivery_state: 'blocked',
    failure_code: 'task_action_unavailable',
  }), 'operation'), true);
  check(s, 'mirror: recovery_blocked still pending', camelize(cancel('recovery_blocked'), 'operation'), true, false);
}

// PublicTask (+mirror spot checks)
check('PublicTask', 'running', task('running', 2, null, ['cancel', 'read_output']), true);
check('PublicTask', 'pending', task('pending', null, null, ['cancel']), true);
check('PublicTask', 'completed', task('completed', 2, 3, ['read_output']), true);
check('PublicTask', 'recovery_blocked may cancel', task('recovery_blocked', 2, null, ['cancel']), true);
check('PublicTask', 'terminal without settled_at', task('failed', 2, null), false);
check('PublicTask', 'terminal still cancellable', task('completed', 2, 3, ['cancel']), false);
check('PublicTask', 'running with settled_at', task('running', 2, 3), false);
check('PublicTask', 'recovery_blocked with settled_at', task('recovery_blocked', 2, 3), false);
check('PublicTask', 'duplicate capability', task('running', 2, null, ['cancel', 'cancel']), false);
check('PublicTask', 'artifact_refs at the bound',
  task('running', 2, null, [], { artifact_refs: Array.from({ length: 100 }, (_, i) => `artifact-${i}`) }), true);
check('PublicTask', 'artifact_refs over the bound',
  task('running', 2, null, [], { artifact_refs: Array.from({ length: 101 }, (_, i) => `artifact-${i}`) }), false);
check('PublicTask', 'duplicate artifact_ref',
  task('running', 2, null, [], { artifact_refs: ['artifact-1', 'artifact-1'] }), false);
check('PublicTask', 'leaked runtime_binding_id',
  task('running', 2, null, [], { runtime_binding_id: 'x' }), false);
check('WebShellTask', 'mirror: artifact_refs over the bound',
  camelize(task('running', 2, null, [], { artifact_refs: Array.from({ length: 101 }, (_, i) => `artifact-${i}`) }), 'task'), false);
check('WebShellTask', 'mirror: completed', camelize(task('completed', 2, 3, ['read_output']), 'task'), true);

// PublicTaskEvent
check('PublicTaskEvent', 'state_changed', event('state_changed', { state: 'running' }), true);
check('PublicTaskEvent', 'output', event('output', { text: 'x' }), true);
check('PublicTaskEvent', 'artifact', event('artifact', { artifact_id: 'artifact-1' }), true);
check('PublicTaskEvent', 'a later event type', event('input_received'), true);
check('PublicTaskEvent', 'unknown field on a later type', event('input_received', { future_field: 'x' }), false);
check('PublicTaskEvent', 'unknown field on a known type', event('output', { text: 'x', future_field: 'x' }), false);
check('PublicTaskEvent', 'state_changed without state', event('state_changed'), false);
check('PublicTaskEvent', 'artifact without artifact_id', event('artifact'), false);
check('PublicTaskEvent', 'output without text', event('output'), false);
check('PublicTaskEvent', 'empty output', event('output', { text: '' }), false);
for (const f of ['cursor', 'schema_version', 'projection_version']) {
  const e = event('output', { text: 'x' });
  delete e[f];
  check('PublicTaskEvent', `event without ${f}`, e, false);
}
// event field totality probes (companions per design 4.3)
const companions = { state_changed: ['runtime_state'], output: ['truncated'], artifact: [] };
const minimal = {
  state_changed: event('state_changed', { state: 'running' }),
  output: event('output', { text: 'x' }),
  artifact: event('artifact', { artifact_id: 'artifact-1' }),
};
const values = { state: 'running', runtime_state: 'ready', text: 'x', truncated: false, artifact_id: 'artifact-1' };
const eventSpec = UPDATED.components.schemas.PublicTaskEvent;
const requiredEv = new Set(eventSpec.required);
const optionalEv = Object.keys(eventSpec.properties).filter((p) => !requiredEv.has(p));
for (const cond of eventSpec.allOf) {
  const type = cond.if?.properties?.type?.const;
  if (!companions[type]) continue;
  for (const field of optionalEv) {
    if (field in minimal[type]) continue;
    const probe = { ...minimal[type], [field]: values[field] };
    check('PublicTaskEvent', `${type} with ${field}`, probe, companions[type].includes(field));
  }
}
check('WebShellTaskEvent', 'mirror: unknown field on a known type',
  camelize(event('output', { text: 'x', future_field: 'x' }), 'event'), false);
check('WebShellTaskEvent', 'mirror: output with state',
  camelize(event('output', { text: 'x', state: 'running' }), 'event'), false);

// PublicTaskEventList
const page = (data, hasMore, next) => ({
  object: 'list',
  data,
  has_more: hasMore,
  ...(next !== undefined ? { next_cursor: next } : {}),
});
const ev1 = event('output', { text: 'x' });
check('PublicTaskEventList', 'full page', page([ev1], true, 'cursor-1'), true);
check('PublicTaskEventList', 'last page keeps its position', page([ev1], false, 'cursor-1'), true);
check('PublicTaskEventList', 'empty page keeps its position', page([], true, 'cursor-1'), true);
check('PublicTaskEventList', 'empty page with null cursor', page([], false, null), false);
check('PublicTaskEventList', 'empty page without cursor', page([], false), false);
check('PublicTaskEventList', 'page at the 100 event bound',
  page(Array.from({ length: 100 }, (_, i) => ({ ...ev1, cursor: `cursor-${i}` })), true, 'cursor-99'), true);
check('PublicTaskEventList', 'page over the 100 event bound',
  page(Array.from({ length: 101 }, (_, i) => ({ ...ev1, cursor: `cursor-${i}` })), true, 'cursor-100'), false);
check('WebShellTaskEventPage', 'mirror: empty page with null cursor',
  camelize(page([], false, null), 'event'), false);

// ---- run checks against both specs ----
const results = { baseline: { pass: 0, fail: [] }, updated: { pass: 0, fail: [] } };
for (const c of checks) {
  for (const [name, spec] of [['baseline', BASE], ['updated', UPDATED]]) {
    const validate = compile(spec, c.schema);
    const got = validate(structuredClone(c.instance));
    const want = c[name];
    if (got === want) results[name].pass++;
    else results[name].fail.push(`${c.schema}: ${c.label} (want ${want}, got ${got})`);
  }
}
console.log(`behavioral checks: ${checks.length}`);
console.log(`baseline: ${results.baseline.pass}/${checks.length} passed`);
for (const f of results.baseline.fail) console.log(`  BASELINE FAIL: ${f}`);
console.log(`updated:  ${results.updated.pass}/${checks.length} passed`);
for (const f of results.updated.fail) console.log(`  UPDATED FAIL: ${f}`);

// ---- mutation suite: each mutation must be caught by a behavioral assertion ----
const M = [];
const mutate = (label, fn, schema, probeLabel, probeInstance, probeWant) =>
  M.push({ label, fn, schema, probeLabel, probeInstance, probeWant });

const findCancelCond = (spec) =>
  spec.components.schemas.PublicCommandOperation.allOf.find(
    (c) => c.if?.properties?.type?.const === 'task_cancel' && c.then?.properties?.status,
  );
mutate('drop the whole task_cancel outcome conditional',
  (s) => {
    const allOf = s.components.schemas.PublicCommandOperation.allOf;
    allOf.splice(allOf.indexOf(findCancelCond(s)), 1);
  },
  'PublicCommandOperation', 'cancelled task_cancel accepted again',
  cancel('cancelled'), false);
mutate('allow task_cancel to be cancelled',
  (s) => { delete findCancelCond(s).then.properties.status; },
  'PublicCommandOperation', 'cancelled task_cancel accepted again',
  cancel('cancelled'), false);
mutate('drop the failure_code requirement',
  (s) => {
    findCancelCond(s).then.allOf = findCancelCond(s).then.allOf.filter(
      (c) => c.if?.properties?.status?.const !== 'failed');
  },
  'PublicCommandOperation', 'failed without reason accepted again',
  cancel('failed', { delivery_state: 'blocked' }), false);
mutate('drop the completed admission_stage pin',
  (s) => {
    const c = findCancelCond(s).then.allOf.find(
      (x) => x.if?.properties?.status?.const === 'completed');
    delete c.then.properties.admission_stage;
  },
  'PublicCommandOperation', 'completed with java_durable admission accepted',
  cancel('completed', { delivery_state: 'confirmed', receipt_id: 'receipt-1' }), false);
mutate('drop the completed delivery_state pin',
  (s) => {
    const c = findCancelCond(s).then.allOf.find(
      (x) => x.if?.properties?.status?.const === 'completed');
    delete c.then.properties.delivery_state;
  },
  'PublicCommandOperation', 'completed with unconfirmed delivery accepted',
  cancel('completed', { admission_stage: 'harness_confirmed', receipt_id: 'receipt-1' }), false);
mutate('drop the settled delivery_state=blocked pin',
  (s) => {
    const c = findCancelCond(s).then.allOf.find(
      (x) => Array.isArray(x.if?.properties?.status?.enum));
    delete c.then.properties.delivery_state;
  },
  'PublicCommandOperation', 'recovery_blocked still pending accepted',
  cancel('recovery_blocked'), false);
mutate('drop the settled admission_stage=java_durable pin',
  (s) => {
    const c = findCancelCond(s).then.allOf.find(
      (x) => Array.isArray(x.if?.properties?.status?.enum));
    delete c.then.properties.admission_stage;
  },
  'PublicCommandOperation', 'failed with confirmed admission accepted',
  cancel('failed', { delivery_state: 'blocked', failure_code: 'task_action_unavailable',
    admission_stage: 'harness_confirmed', receipt_id: 'receipt-1' }), false);
mutate('open PublicTaskEvent additionalProperties',
  (s) => { s.components.schemas.PublicTaskEvent.additionalProperties = true; },
  'PublicTaskEvent', 'unknown event field accepted',
  event('output', { text: 'x', future_field: 'x' }), false);
mutate('drop the output prohibition on state',
  (s) => {
    const c = s.components.schemas.PublicTaskEvent.allOf.find(
      (x) => x.if?.properties?.type?.const === 'output');
    delete c.then.not;
  },
  'PublicTaskEvent', 'output carrying state accepted',
  event('output', { text: 'x', state: 'running' }), false);
mutate('drop artifact_refs uniqueItems',
  (s) => { delete s.components.schemas.PublicTask.properties.artifact_refs.uniqueItems; },
  'PublicTask', 'duplicate artifact_ref accepted',
  task('running', 2, null, [], { artifact_refs: ['a', 'a'] }), false);

let mutationsCaught = 0;
for (const m of M) {
  const spec = structuredClone(UPDATED);
  m.fn(spec);
  let caught = false;
  try {
    const validate = compile(spec, m.schema);
    caught = validate(structuredClone(m.probeInstance)) !== m.probeWant;
  } catch {
    caught = true; // schema no longer compiles: caught
  }
  if (caught) mutationsCaught++;
  console.log(`mutation ${caught ? 'CAUGHT ' : 'MISSED'}: ${m.label} (${m.probeLabel})`);
}

const ok =
  results.baseline.fail.length === 0 &&
  results.updated.fail.length === 0 &&
  mutationsCaught === M.length;
console.log(
  `\nRESULT: ${results.baseline.pass}+${results.updated.pass} behavioral checks, ` +
    `${mutationsCaught}/${M.length} mutations caught — ${ok ? 'ALL PASS' : 'FAILURES PRESENT'}`,
);
process.exit(ok ? 0 : 1);
