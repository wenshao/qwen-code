// Usage: node probe-records.mjs <label> <worktree> <mode> [arg]
// Loads the BUILT core (packages/core/dist) of <worktree> — no vitest, no TS.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [label, wt, mode, arg] = process.argv.slice(2);
const dist = path.join(wt, 'packages/core/dist/src/managed-runtime');
const rec = await import(
  pathToFileURL(path.join(dist, 'managed-session-records.js')).href
);
const { parseManagedSessionEvent, ManagedSessionRecordError } = rec;

const DIGEST = 'a'.repeat(64);
const sessionKey = { tenantId: 't1', workspaceId: 'w1', sessionId: 's1' };
const ref = (kind = 'managed-test') => ({
  resourceId: 'res-1',
  kind,
  schemaVersion: 1,
  byteLength: 4,
  digest: DIGEST,
});
const envelope = (kind, sequence, payload, extra = {}) => ({
  v: 1,
  sequence,
  eventId: `evt-${sequence}`,
  sessionKey,
  kind,
  occurredAt: 1,
  ...extra,
  payload,
});
const cancel = (target, reason = 'test') =>
  envelope('cancel.requested', 2, {
    requestId: 'req-1',
    target,
    reason,
    requestedBy: 'user',
  });

function outcome(fn) {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      cls: e instanceof ManagedSessionRecordError ? 'RecordError' : e.name,
      msg: String(e.message).slice(0, 140),
    };
  }
}
const show = (o) => (o.ok ? 'ACCEPT' : `REJECT(${o.cls}): ${o.msg}`);

function dag(n) {
  let shared = { leaf: 1 };
  for (let i = 0; i < n; i++) shared = { a: shared, b: shared };
  return shared;
}
function chain(len) {
  let c = null;
  for (let i = 0; i < len; i++) c = { nested: c };
  return c;
}

if (mode === 'dag') {
  const n = Number(arg);
  const target = dag(n);
  const t0 = process.hrtime.bigint();
  const o = outcome(() => parseManagedSessionEvent(cancel(target)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(
    `RESULT\t${label}\tdag\tN=${n}\tobjects=${n + 1}\tpaths=2^${n}\t${ms.toFixed(1)}ms\t${show(o)}`,
  );
} else if (mode === 'unknown-key-dag') {
  // A DAG on a field the schema does not know: assertJsonValue walks the
  // whole event before the unknown-key check, so this is the same hazard.
  const n = Number(arg);
  const ev = cancel({ x: 1 });
  ev.payload.extra = dag(n);
  const t0 = process.hrtime.bigint();
  const o = outcome(() => parseManagedSessionEvent(ev));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(
    `RESULT\t${label}\tunknown-key-dag\tN=${n}\t${ms.toFixed(1)}ms\t${show(o)}`,
  );
} else if (mode === 'boundary') {
  // target sits at depth 3 (event=1, payload=2). first.chain top at 4,
  // shell.second chain top at 5. A chain of L objects ends at depth 4+L-1
  // via `first` and 5+L-1 via `shell.second`; maxJsonDepth = 64.
  for (const len of [58, 59, 60, 61]) {
    const c = chain(len);
    const shared = { first: c, shell: { second: c } };
    const unshared = { first: chain(len), shell: { second: chain(len) } };
    const roundTrip = JSON.parse(JSON.stringify(shared));
    const clone = structuredClone(shared);
    const secondOnly = { shell: { second: chain(len) } };
    const rows = {
      shared: outcome(() => parseManagedSessionEvent(cancel(shared))),
      unshared: outcome(() => parseManagedSessionEvent(cancel(unshared))),
      jsonRoundTrip: outcome(() => parseManagedSessionEvent(cancel(roundTrip))),
      structuredClone: outcome(() => parseManagedSessionEvent(cancel(clone))),
      secondPathOnly: outcome(() =>
        parseManagedSessionEvent(cancel(secondOnly)),
      ),
    };
    for (const [k, o] of Object.entries(rows)) {
      console.log(
        `RESULT\t${label}\tboundary\tchain=${len}\tdeepest-object-via-second=${5 + len - 1}\t${k}\t${o.ok ? 'ACCEPT' : 'REJECT'}`,
      );
    }
  }
  // Minimal shape from the triage nit: {a:1} shared at the boundary.
  for (const d of [63, 64]) {
    // wrap so the shared leaf object sits at depth d
    const leaf = { a: 1 };
    let sharedT = { p: leaf, q: leaf };
    let unsharedT = { p: { a: 1 }, q: { a: 1 } };
    for (let i = 0; i < d - 4; i++) {
      sharedT = { w: sharedT };
      unsharedT = { w: unsharedT };
    }
    console.log(
      `RESULT\t${label}\tleaf-object-at-depth=${d}\tshared=${outcome(() => parseManagedSessionEvent(cancel(sharedT))).ok ? 'ACCEPT' : 'REJECT'}\tunshared=${outcome(() => parseManagedSessionEvent(cancel(unsharedT))).ok ? 'ACCEPT' : 'REJECT'}`,
    );
  }
} else if (mode === 'rules') {
  const actSubj = {
    type: 'activation',
    scopeId: 'scope-1',
    activationId: 'act-1',
    epoch: 3,
  };
  const activation = (over = {}, extra = {}) =>
    envelope(
      'activation.changed',
      3,
      {
        activationId: 'act-1',
        epoch: 3,
        workerId: 'worker-1',
        subject: actSubj,
        phase: 'active',
        leaseDurationMs: 60_000,
        expiresAt: 1_700_000_060_000,
        installRef: ref(),
        boundaryRef: null,
        ...over,
      },
      extra,
    );
  const wake = (extra = {}) =>
    envelope(
      'wake.requested',
      2,
      {
        wakeId: 'wake-1',
        reason: 'input',
        subject: { type: 'turn', turnId: 'turn-1' },
        sourceEventId: 'evt-1',
        requiredSequence: 1,
      },
      extra,
    );
  const message = (over = {}) =>
    envelope('message.committed', 4, {
      messageId: 'msg-1',
      role: 'assistant',
      contentRef: ref(),
      modelAttemptId: null,
      parentMessageId: null,
      ...over,
    });
  const checkpoint = (over = {}) =>
    envelope(
      'checkpoint.committed',
      4,
      {
        checkpointId: 'cp-1',
        coveredSequence: 1,
        previousCheckpointId: null,
        stateRef: ref(),
        boundary: null,
        ...over,
      },
      { subject: actSubj },
    );
  const config = (over = {}) =>
    envelope('config.bound', 4, {
      revision: 2,
      previousRevision: 1,
      bundleRef: ref(),
      rootSnapshotRef: ref(),
      ...over,
    });
  const cases = [
    ['R3-3', 'activation.changed, subject = payload identity', activation()],
    [
      'R3-3',
      'activation.changed, subject.activationId=act-2 (payload act-1)',
      activation({ subject: { ...actSubj, activationId: 'act-2' } }),
    ],
    [
      'R3-3',
      'activation.changed, subject.epoch=4 (payload 3)',
      activation({ subject: { ...actSubj, epoch: 4 } }),
    ],
    [
      'R3-3',
      'activation.changed, hook_operation payload subject (legal)',
      activation({
        subject: {
          type: 'hook_operation',
          operationId: 'op-1',
          occurrenceId: 'oc-1',
        },
      }),
    ],
    [
      'R3-3',
      'activation.changed, envelope subject == payload subject',
      activation({}, { subject: actSubj }),
    ],
    [
      'R3-3',
      'activation.changed, envelope subject = turn (payload activation)',
      activation({}, { subject: { type: 'turn', turnId: 'turn-1' } }),
    ],
    ['R3-3', 'wake.requested, no envelope subject', wake()],
    [
      'R3-3',
      'wake.requested, envelope turn-1 == payload turn-1',
      wake({ subject: { type: 'turn', turnId: 'turn-1' } }),
    ],
    [
      'R3-3',
      'wake.requested, envelope turn-9 vs payload turn-1',
      wake({ subject: { type: 'turn', turnId: 'turn-9' } }),
    ],
    ['R3-4', 'message.committed, parentMessageId=null', message()],
    [
      'R3-4',
      'message.committed, parentMessageId=msg-0',
      message({ parentMessageId: 'msg-0' }),
    ],
    [
      'R3-4',
      'message.committed, parentMessageId=messageId',
      message({ parentMessageId: 'msg-1' }),
    ],
    [
      'R3-4',
      'checkpoint.committed, previousCheckpointId=cp-0',
      checkpoint({ previousCheckpointId: 'cp-0' }),
    ],
    [
      'R3-4',
      'checkpoint.committed, previousCheckpointId=checkpointId',
      checkpoint({ previousCheckpointId: 'cp-1' }),
    ],
    ['R3-4', 'config.bound, 1 -> 2', config()],
    [
      'R3-4',
      'config.bound, previousRevision=null',
      config({ revision: 0, previousRevision: null }),
    ],
    [
      'R3-4',
      'config.bound, 5 -> 5',
      config({ revision: 5, previousRevision: 5 }),
    ],
    [
      'R3-4',
      'config.bound, 7 -> 1',
      config({ revision: 1, previousRevision: 7 }),
    ],
  ];
  for (const [id, name, ev] of cases) {
    const o = outcome(() => parseManagedSessionEvent(ev));
    console.log(`RESULT\t${label}\t${id}\t${name}\t${show(o)}`);
  }
} else if (mode === 'fuzz') {
  // R3-5: accept/reject bitmap over every code point embedded in a text
  // field, plus an ANSI/C1 corpus; written to <arg> for a cross-build diff.
  const out = [];
  const t0 = Date.now();
  const bits = Buffer.alloc(0x110000);
  for (let cp = 0; cp < 0x110000; cp++) {
    const s = 'a' + String.fromCodePoint(cp) + 'b';
    bits[cp] = outcome(() => parseManagedSessionEvent(cancel({}, s))).ok
      ? 0
      : 1;
  }
  const corpus = [
    'plain',
    '\u001b[31mred\u001b[0m',
    '\u009b31mC1-CSI',
    '\u001b]0;title\u0007',
    '\u001b]8;;http://x\u001b\\link',
    'tab\there',
    'nl\nhere',
    'del\u007f',
    'nbsp ok',
    'zwj‍ok',
    'bidi‮ok',
    'line sep',
    'bom﻿ok',
    'esc-alone\u001b',
    'emoji😀ok',
    '\ud800lone-high',
    '\udc00lone-low',
    '中文',
  ];
  // deterministic pseudo-random strings mixing the corpus pieces
  const seeds = corpus.slice();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 20000; i++) {
    let s = '';
    const parts = 1 + Math.floor(rnd() * 4);
    for (let p = 0; p < parts; p++) {
      s += seeds[Math.floor(rnd() * seeds.length)];
      if (rnd() < 0.3) s += String.fromCharCode(Math.floor(rnd() * 0x200));
    }
    corpus.push(s);
  }
  const corpusBits = corpus.map((s) =>
    outcome(() => parseManagedSessionEvent(cancel({}, s))).ok ? '0' : '1',
  );
  fs.writeFileSync(arg, Buffer.concat([bits, Buffer.from(corpusBits.join(''))]));
  let rejected = 0;
  for (const b of bits) rejected += b;
  console.log(
    `RESULT\t${label}\tfuzz\tcodepoints=${0x110000}\trejected=${rejected}\tcorpus=${corpus.length}\tcorpusRejected=${corpusBits.filter((b) => b === '1').length}\t${Date.now() - t0}ms`,
  );
} else {
  throw new Error(`unknown mode ${mode}`);
}
