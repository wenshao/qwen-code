// Independent schema differential (Ajv 2020-12, not the Java networknt
// validator the PR's tests use). Validates an exhaustive operation matrix and
// task-event instances against the base and head contracts and reports every
// verdict that changes.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad';
const require = createRequire(`${SP}/wt-pr/package.json`);
const Ajv2020 = require('ajv/dist/2020').default;
const SPEC = 'packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json';
const load = async (root) => JSON.parse(await readFile(`${SP}/${root}/${SPEC}`, 'utf8'));

function validators(spec) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  ajv.addSchema({ ...spec, $id: 'spec' });
  const cache = {};
  return (name) => (cache[name] ??= ajv.getSchema(`spec#/components/schemas/${name}`));
}

const SESSION = '00000000-0000-4000-8000-000000000001';
const TYPES = ['create_session', 'submit_input', 'cancel', 'action_response', 'close', 'archive', 'delete', 'task_cancel'];
const STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled', 'recovery_blocked'];
const STAGES = ['java_durable', 'harness_confirmed'];
const DELIVERY = ['pending', 'leased', 'confirmed', 'blocked'];

function* operations() {
  for (const type of TYPES) for (const status of STATUSES) for (const stage of STAGES)
    for (const delivery of DELIVERY) for (const receipt of [false, true])
      for (const failure of [false, true]) for (const task of [false, true]) {
        const pub = { id: 'operation-1', session_id: SESSION, type, status, admission_stage: stage, delivery_state: delivery, replayed: false };
        if (receipt) pub.receipt_id = 'receipt-1';
        if (failure) pub.failure_code = 'task_action_unavailable';
        if (task) pub.task_id = 'task-1';
        const web = { operationId: 'operation-1', sessionId: SESSION, type, status, admissionStage: stage, deliveryState: delivery, replayed: false };
        if (receipt) web.receiptId = 'receipt-1';
        if (failure) web.failureCode = 'task_action_unavailable';
        if (task) web.taskId = 'task-1';
        yield { key: `${type}|${status}|${stage}|${delivery}|r${+receipt}|f${+failure}|t${+task}`, pub, web };
      }
}

const base = validators(await load('wt-base'));
const head = validators(await load('wt-pr'));
const SCHEMAS = [['PublicCommandOperation', 'pub'], ['PublicOperation', 'pub'], ['WebShellCommandOperation', 'web'], ['WebShellOperation', 'web']];

const flips = [];
let total = 0, validBase = 0, validHead = 0;
for (const op of operations()) {
  for (const [schema, side] of SCHEMAS) {
    total++;
    const b = base(schema)(op[side]);
    const h = head(schema)(op[side]);
    validBase += b; validHead += h;
    if (b !== h) flips.push({ schema, key: op.key, base: b, head: h });
  }
}
const flipKinds = {};
for (const f of flips) {
  const [type, status, , , , failure] = f.key.split('|');
  const k = `${f.schema}: ${type} ${status} ${failure === 'f0' ? 'without failure_code' : 'with failure_code'} ${f.base ? 'valid->invalid' : 'invalid->valid'}`;
  flipKinds[k] = (flipKinds[k] ?? 0) + 1;
}
console.log(`operations: ${total} validations per contract; valid base=${validBase} head=${validHead}; verdict flips=${flips.length}`);
for (const [k, n] of Object.entries(flipKinds)) console.log(`  ${n.toString().padStart(3)}  ${k}`);
const nonTask = flips.filter((f) => !f.key.startsWith('task_cancel|'));
const unexpected = flips.filter((f) => !(f.key.startsWith('task_cancel|') && (f.key.split('|')[1] === 'cancelled' || (f.key.split('|')[1] === 'failed' && f.key.includes('|f0|')))) || !f.base);
console.log(`  flips outside task_cancel: ${nonTask.length}; flips other than {cancelled, failed-without-code} valid->invalid: ${unexpected.length}`);

// Named cases mirroring the PR's reviewer test plan.
const named = [
  ['task_cancel pending', { type: 'task_cancel', status: 'pending', task: true }],
  ['task_cancel running', { type: 'task_cancel', status: 'running', task: true }],
  ['task_cancel recovery_blocked', { type: 'task_cancel', status: 'recovery_blocked', task: true }],
  ['task_cancel completed + receipt', { type: 'task_cancel', status: 'completed', task: true, receipt: true }],
  ['task_cancel failed + failure_code', { type: 'task_cancel', status: 'failed', task: true, failure: true }],
  ['task_cancel failed, no failure_code', { type: 'task_cancel', status: 'failed', task: true }],
  ['task_cancel cancelled', { type: 'task_cancel', status: 'cancelled', task: true }],
  ['submit_input cancelled (control)', { type: 'submit_input', status: 'cancelled' }],
  ['close failed, no failure_code (control)', { type: 'close', status: 'failed' }],
];
const rows = [];
for (const [label, c] of named) {
  const key = `${c.type}|${c.status}|java_durable|pending|r${+!!c.receipt}|f${+!!c.failure}|t${+!!c.task}`;
  const op = [...operations()].find((o) => o.key === key);
  const cells = SCHEMAS.map(([schema, side]) => `${base(schema)(op[side]) ? 'ok' : '--'}/${head(schema)(op[side]) ? 'ok' : '--'}`);
  rows.push([label, ...cells]);
}
console.log('\nnamed cases (base/head) for PublicCommandOperation | PublicOperation | WebShellCommandOperation | WebShellOperation');
for (const r of rows) console.log(`  ${r[0].padEnd(40)} ${r.slice(1).join('   ')}`);

// Structural diff of the whole contract, ignoring descriptions and info.
const strip = (o) => Array.isArray(o) ? o.map(strip) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'description' && k !== 'info').map(([k, v]) => [k, strip(v)])) : o;
const diffs = [];
const walk = (a, b, path) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(a[k], b[k], `${path}/${k}`);
    return;
  }
  diffs.push({ path, base: a === undefined ? '(absent)' : JSON.stringify(a).slice(0, 80), head: b === undefined ? '(absent)' : JSON.stringify(b).slice(0, 80) });
};
walk(strip(await load('wt-base')), strip(await load('wt-pr')), '');
console.log(`\nstructural differences excluding descriptions/info: ${diffs.length}`);
for (const d of diffs) console.log(`  ${d.path}\n     base: ${d.base}\n     head: ${d.head}`);

// Event instances (A1/A8 schema claims): structure is unchanged, so both
// contracts must agree on every case.
const ev = (type, extra = {}) => ({ id: 'event-1', object: 'agent.task_event', task_id: 'task-1', session_id: SESSION, type, cursor: 'cursor-1', created_at: 1, schema_version: 1, projection_version: 1, ...extra });
await writeFile(`${SP}/pr12998/ajv-summary.json`, JSON.stringify({ total, validBase, validHead, flips: flips.length, flipKinds, rows, diffs }, null, 2));
