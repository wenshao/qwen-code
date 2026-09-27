// PublicCommandOperation / WebShellCommandOperation: task_cancel conditionals,
// public/WebShell parity, and base-vs-head regression for pre-existing types.
import { loadSpec } from './spec-validator.mjs';
const head = loadSpec(process.argv[2]), base = loadSpec(process.argv[3]);
const SID = '7794b11a-8ae6-4e7a-9a4e-8bdee3e76cea';
const M = { id: 'operationId', session_id: 'sessionId', admission_stage: 'admissionStage', delivery_state: 'deliveryState', receipt_id: 'receiptId', action_resolution: 'actionResolution', failure_code: 'failureCode', task_id: 'taskId', action_id: 'actionId', decision_receipt_id: 'decisionReceiptId' };
const web = (o) => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [M[k] ?? k, web(v)])) : o;
const TYPES = head.spec.components.schemas.PublicCommandOperation.properties.type.enum;
const out = { total: 0, oracleMismatch: [], parity: [], baseRegression: [], baseComparable: 0 };
for (const type of TYPES) for (const withTask of [0, 1]) for (const withRes of [0, 1]) for (const status of ['pending', 'completed']) {
  const op = { id: 'op1', session_id: SID, type, status, admission_stage: 'java_durable', delivery_state: 'pending', receipt_id: 'r1', replayed: false };
  if (withTask) op.task_id = 'task-1';
  if (withRes) op.action_resolution = { action_id: 'a1', outcome: 'decided', receipt_id: 'r2', decision_receipt_id: 'r3' };
  let expect = true;
  if (type === 'task_cancel' ? !withTask : withTask) expect = false;
  if (withRes && type !== 'action_response') expect = false;
  if (type === 'action_response' && status === 'completed' && !withRes) expect = false;
  const h = head.schema('PublicCommandOperation', op), w = head.schema('WebShellCommandOperation', web(op));
  out.total++;
  if (h.ok !== expect) out.oracleMismatch.push({ type, withTask, withRes, status, expect, got: h.ok, errors: h.errors });
  if (h.ok !== w.ok) out.parity.push({ type, withTask, withRes, status, pub: h.ok, web: w.ok });
  if (type !== 'task_cancel' && !withTask) {
    out.baseComparable++;
    const b = base.schema('PublicCommandOperation', op), bw = base.schema('WebShellCommandOperation', web(op));
    if (b.ok !== h.ok || bw.ok !== w.ok) out.baseRegression.push({ type, withRes, status, base: [b.ok, bw.ok], head: [h.ok, w.ok] });
  }
}
console.log(JSON.stringify(out, null, 1));
