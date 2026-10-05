// Usage: node probe-records.mjs <label> <worktree>
// Drives the BUILT core of <worktree> (parseManagedSessionEvent) with the
// round-2 delta cases: F1 validator half, F2 exact-depth sharing, the new
// guards of 2f2298bc6e, and the R2-1 bound arithmetic.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [label, wt] = process.argv.slice(2);
const core = path.join(wt, 'packages/core/dist/src/managed-runtime');
const { parseManagedSessionEvent, MANAGED_SESSION_LIMITS } = await import(
  pathToFileURL(path.join(core, 'managed-session-records.js')).href
);

const sessionKey = {
  tenantId: 't1',
  workspaceId: 'w1',
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
};
const DIGEST = 'e'.repeat(64);
const ref = () => ({
  resourceId: 'res-1',
  kind: 'managed-test',
  schemaVersion: 1,
  byteLength: 4,
  digest: DIGEST,
});
const act = { type: 'activation', scopeId: 'act-1', activationId: 'act-1', epoch: 1 };
const ev = (kind, payload, extra = {}) => ({
  v: 1,
  sequence: 2,
  eventId: 'evt-2',
  sessionKey,
  kind,
  occurredAt: 3,
  ...extra,
  payload,
});
const cancel = (target) =>
  ev('cancel.requested', { requestId: 'req-1', target, reason: 'probe', requestedBy: 'user' });
const activation = (subject) =>
  ev('activation.changed', {
    activationId: 'act-1',
    epoch: 1,
    workerId: 'worker-1',
    subject,
    phase: 'active',
    leaseDurationMs: 60000,
    expiresAt: 2,
    installRef: ref(),
    boundaryRef: null,
  });
const wake = (sourceEventId, extra) =>
  ev(
    'wake.requested',
    {
      wakeId: 'wake-1',
      reason: 'input',
      subject: { type: 'turn', turnId: 'turn-1' },
      sourceEventId,
      requiredSequence: 1,
    },
    extra,
  );

function run(name, build) {
  const value = build();
  const t0 = process.hrtime.bigint();
  let verdict;
  try {
    parseManagedSessionEvent(value);
    verdict = 'ACCEPT';
  } catch (e) {
    verdict = `REJECT ${e.constructor.name}: ${String(e.message).replace(/(\.[ab]){4,}/g, '.…').slice(0, 110)}`;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`RESULT\t${label}\t${name}\t${verdict}\t${ms.toFixed(2)}ms`);
  return verdict;
}

// F1 (validator half): t = { a: t, b: t } — 2^N paths, N+1 objects.
for (const n of process.env.SKIP_DAG ? [] : [24, 28, 40]) {
  run(`dag-N${n}`, () => {
    let t = { leaf: 1 };
    for (let i = 0; i < n; i++) t = { a: t, b: t };
    return cancel(t);
  });
}

// F2: one chain reached twice under target.shell.{first,second}.
// payload.target sits at depth 3 (event=1, payload=2, target=3), shell=4,
// so a chain of k objects ends at depth 4 + k.
const chain = (k) => {
  let c = { leaf: 1 };
  for (let i = 1; i < k; i++) c = { next: c };
  return c;
};
for (const k of [60, 61]) {
  run(`shared-chain-${k} (deepest object at depth ${4 + k})`, () => {
    const c = chain(k);
    return cancel({ shell: { first: c, second: c } });
  });
  run(`unshared-chain-${k}`, () =>
    cancel({ shell: { first: chain(k), second: chain(k) } }),
  );
  run(`roundtrip-chain-${k}`, () => {
    const c = chain(k);
    return JSON.parse(JSON.stringify(cancel({ shell: { first: c, second: c } })));
  });
}

// New guards in 2f2298bc6e.
run('R1-11 activation.changed + turn payload subject', () =>
  activation({ type: 'turn', turnId: 'turn-9' }),
);
run('R1-11 activation.changed + hook_operation payload subject (must stay legal)', () =>
  activation({ type: 'hook_operation', operationId: 'op-1', occurrenceId: 'occ-1' }),
);
run('R1-11 activation.changed + matching activation payload subject (control)', () =>
  activation(act),
);
run('R1-9 wake.requested sourceEventId === eventId', () => wake('evt-2'));
run('R1-9 wake.requested sourceEventId !== eventId (control)', () => wake('evt-1'));
for (const [field, value] of [
  ['scopeId', 'scope-2'],
  ['activationId', 'act-9'],
  ['epoch', 7],
]) {
  run(`R1-5 envelope activation subject differs only in ${field}`, () => ({
    ...activation(act),
    subject: { ...act, [field]: value },
  }));
}
for (const [field, value] of [
  ['operationId', 'op-2'],
  ['occurrenceId', 'occ-2'],
]) {
  run(`R1-5 envelope hook_operation subject differs only in ${field}`, () => ({
    ...activation({ type: 'hook_operation', operationId: 'op-1', occurrenceId: 'occ-1' }),
    subject: { type: 'hook_operation', operationId: 'op-1', occurrenceId: 'occ-1', [field]: value },
  }));
}

// R2-1: what the accepted expansion really serializes to.
const leaves = {
  'NUL x1000': '\u0000'.repeat(1000),
  'CJK x1000': '中'.repeat(1000),
  'ASCII x1000': 'a'.repeat(1000),
};
for (const [name, leaf] of Object.entries(leaves)) {
  let lastAccepted;
  let refused = false;
  for (let n = 8; n <= 16; n++) {
    let t = { leaf };
    for (let i = 0; i < n; i++) t = { a: t, b: t };
    const value = cancel(t);
    let ok = true;
    try {
      parseManagedSessionEvent(value);
    } catch {
      ok = false;
    }
    if (!ok) {
      const bytes = lastAccepted
        ? Buffer.byteLength(JSON.stringify(lastAccepted.value), 'utf8')
        : 0;
      console.log(
        `RESULT\t${label}\tR2-1 leaf=${name}\tlargest accepted N=${lastAccepted?.n}\treal event bytes=${bytes}\t${(bytes / MANAGED_SESSION_LIMITS.maxTransactionBytes).toFixed(2)}x maxTransactionBytes\t${(bytes / MANAGED_SESSION_LIMITS.maxEventBytes).toFixed(1)}x maxEventBytes\tfirst refused N=${n}`,
      );
      refused = true;
      break;
    }
    lastAccepted = { n, value };
  }
  if (!refused) {
    console.log(`RESULT\t${label}\tR2-1 leaf=${name}\tno refusal up to N=16 (real event bytes at N=16: ${Buffer.byteLength(JSON.stringify(lastAccepted.value), 'utf8')})`);
  }
}
