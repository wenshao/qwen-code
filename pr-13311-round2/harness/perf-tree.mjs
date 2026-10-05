// Usage: node perf-tree.mjs <label> <worktree> <reps>
// Large LEGAL trees (no sharing) through the built core's two read-side
// entry points. The memo (Map insert per object + per-child closure) is new
// work on every object even when nothing is shared, so this measures what
// the fix costs the common path.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [label, wt, repsArg] = process.argv.slice(2);
const reps = Number(repsArg ?? 15);
const core = path.join(wt, 'packages/core/dist/src/managed-runtime');
const { parseManagedSessionRecordJson, parseManagedSessionEvent, MANAGED_SESSION_LIMITS } =
  await import(pathToFileURL(path.join(core, 'managed-session-records.js')).href);

const sessionKey = { tenantId: 't1', workspaceId: 'w1', sessionId: '550e8400-e29b-41d4-a716-446655440000' };
// ~7.9 MB record body: 40k small objects (the shape of a resource body).
const rows = [];
for (let i = 0; i < 40000; i++) {
  rows.push({ id: `row-${i}`, n: i, ok: i % 2 === 0, tags: ['a', 'b'], meta: { k: 'v'.repeat(120) } });
}
const bigText = JSON.stringify({ rows });
// ~1 MB event (the per-event ceiling): a cancel target tree of 5k objects.
const target = [];
for (let i = 0; i < 5000; i++) target.push({ id: `t-${i}`, v: { w: 'x'.repeat(150) } });
const event = { v: 1, sequence: 2, eventId: 'evt-2', sessionKey, kind: 'cancel.requested', occurredAt: 3,
  payload: { requestId: 'req-1', target, reason: 'probe', requestedBy: 'user' } };
const eventBytes = Buffer.byteLength(JSON.stringify(event));

function time(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const a = [];
const b = [];
for (let i = 0; i < reps + 3; i++) {
  const ta = time(() => parseManagedSessionRecordJson(bigText, 16 * 1024 * 1024));
  const tb = time(() => parseManagedSessionEvent(JSON.parse(JSON.stringify(event))));
  if (i >= 3) { a.push(ta); b.push(tb); }
}
console.log(`RESULT\t${label}\trecordJson ${Buffer.byteLength(bigText)}B tree\tmedian ${median(a).toFixed(1)}ms\tmin ${Math.min(...a).toFixed(1)}ms`);
console.log(`RESULT\t${label}\tevent ${eventBytes}B tree (incl. JSON clone)\tmedian ${median(b).toFixed(1)}ms\tmin ${Math.min(...b).toFixed(1)}ms`);
void MANAGED_SESSION_LIMITS;
