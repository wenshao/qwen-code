// Usage:
//   node probe-authority.mjs <label> <worktree> dag <N> <root>
//   node probe-authority.mjs <label> <worktree> contradict <root>
//   node probe-authority.mjs <label> <worktree> read <transcriptPath>
// Drives the BUILT core of <worktree>: a real writer lease, a real on-disk
// Managed Session JSONL log, appends through LocalManagedSessionAuthority, and
// reads back with readManagedSessionLog (the same scan open() runs).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [label, wt, scenario, a1, a2] = process.argv.slice(2);
const core = path.join(wt, 'packages/core/dist/src');
const imp = (p) => import(pathToFileURL(path.join(core, p)).href);
const { LocalManagedSessionAuthority, readManagedSessionLog } = await imp(
  'managed-runtime/managed-session-authority.js',
);
const { LocalManagedSessionResourceStore } = await imp(
  'managed-runtime/managed-session-resources.js',
);
const { Storage } = await imp('config/storage.js');

const DIGEST = 'e'.repeat(64);
const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const sessionKey = { tenantId: 't1', workspaceId: 'w1', sessionId };
const HOLDS = {
  class: 'harness',
  activation: { activationId: 'act-1', epoch: 1 },
};
const actSubject = {
  type: 'activation',
  scopeId: 'act-1',
  activationId: 'act-1',
  epoch: 1,
};
const ref = (kind = 'managed-test') => ({
  resourceId: 'res-1',
  kind,
  schemaVersion: 1,
  byteLength: 4,
  digest: DIGEST,
});
const command = (operation, commandId) => ({
  operation,
  commandId,
  sessionKey,
  contentDigest: DIGEST,
});
const errOf = (e) =>
  `${e?.name ?? 'Error'}${e?.code ? `[${e.code}]` : ''}: ${String(e?.message).slice(0, 150)}`;
const size = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);

async function readBack(transcriptPath) {
  try {
    const scan = await readManagedSessionLog(transcriptPath, sessionKey);
    return `read OK committed=${scan.committed} events=${scan.events.length} kinds=[${scan.events.map((e) => e.kind).join(',')}]`;
  } catch (e) {
    return `read FAILED ${errOf(e)}`;
  }
}

async function setup(root) {
  fs.rmSync(root, { recursive: true, force: true });
  const projectRoot = path.join(root, 'project');
  const runtimeBaseDir = path.join(root, 'runtime');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(runtimeBaseDir, { recursive: true });
  const transcriptPath = path.join(
    new Storage(projectRoot, runtimeBaseDir).getProjectDir(),
    'chats',
    `${sessionId}.jsonl`,
  );
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const store = LocalManagedSessionResourceStore.create({
    runtimeBaseDir,
    sessionKey,
  });
  const lease = await LocalManagedSessionAuthority.acquireWriter({
    runtimeBaseDir,
    sessionId,
    transcriptPath,
  });
  const authority = await LocalManagedSessionAuthority.open({
    lease,
    sessionKey,
    cwd: projectRoot,
    version: 'probe',
    resources: store,
    create: {
      definitionRef: ref('managed-definition'),
      rootSnapshotRef: ref('managed-root'),
      createdBy: 'daemon',
    },
  });
  await authority.appendExecution(
    command('claimActivation', 'cmd-act-1'),
    [
      {
        v: 1,
        sequence: 1,
        eventId: 'evt-act-1',
        sessionKey,
        kind: 'activation.changed',
        occurredAt: 1,
        payload: {
          activationId: 'act-1',
          epoch: 1,
          workerId: 'worker-1',
          subject: actSubject,
          phase: 'active',
          leaseDurationMs: 60_000,
          expiresAt: 2,
          installRef: ref(),
          boundaryRef: null,
        },
      },
    ],
    { class: 'coordinator' },
  );
  return { authority, transcriptPath };
}

let seq = 1;
async function attempt(authority, transcriptPath, name, op, events, actor) {
  const before = size(transcriptPath);
  const t0 = process.hrtime.bigint();
  let result;
  try {
    const receipt = await authority.appendExecution(
      command(op, `cmd-${name}`),
      events,
      actor,
    );
    result = `COMMITTED seq=${receipt.committedSequence ?? '?'}`;
    seq += events.length;
  } catch (e) {
    result = `REFUSED ${errOf(e)}`;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(
    `RESULT\t${label}\t${name}\t${result}\tlogBytes+${size(transcriptPath) - before}\t${ms.toFixed(1)}ms`,
  );
}

const ev = (kind, payload, extra = {}) => ({
  v: 1,
  sequence: seq + 1,
  eventId: `evt-${kind}-${seq + 1}`,
  sessionKey,
  kind,
  occurredAt: 3,
  ...extra,
  payload,
});

if (scenario === 'dag') {
  const n = Number(a1);
  const { authority, transcriptPath } = await setup(a2);
  let shared = { leaf: 1 };
  for (let i = 0; i < n; i++) shared = { a: shared, b: shared };
  await attempt(
    authority,
    transcriptPath,
    `cancel-dag-N${n}`,
    'cancel',
    [
      ev('cancel.requested', {
        requestId: 'req-1',
        target: shared,
        reason: 'probe',
        requestedBy: 'user',
      }),
    ],
    { class: 'trusted_entry' },
  );
  const ru = process.resourceUsage();
  console.log(
    `RESULT\t${label}\tdag-N${n}-resources\tmaxRSS=${Math.round(ru.maxRSS / 1024)}MB\tuserCPU=${(ru.userCPUTime / 1e6).toFixed(2)}s`,
  );
  console.log(`RESULT\t${label}\tdag-N${n}-readback\t${await readBack(transcriptPath)}`);
  await authority.close();
} else if (scenario === 'contradict') {
  const { authority, transcriptPath } = await setup(a1);
  // Legal shared references first: one ref object mounted on two fields and a
  // small shared target DAG. Must commit on both builds.
  let small = { leaf: 1 };
  for (let i = 0; i < 6; i++) small = { a: small, b: small };
  await attempt(
    authority,
    transcriptPath,
    'legal-shared-refs',
    'cancel',
    [
      ev('cancel.requested', {
        requestId: 'req-legal',
        target: { x: small, y: small },
        reason: 'probe',
        requestedBy: 'user',
      }),
    ],
    { class: 'trusted_entry' },
  );
  await attempt(
    authority,
    transcriptPath,
    'R3-3-activation-subject-mismatch',
    'renewActivation',
    [
      ev('activation.changed', {
        activationId: 'act-1',
        epoch: 1,
        workerId: 'worker-1',
        subject: { ...actSubject, activationId: 'act-9', epoch: 7 },
        phase: 'active',
        leaseDurationMs: 60_000,
        expiresAt: 4,
        installRef: ref(),
        boundaryRef: null,
        renewalSeq: 1,
      }),
    ],
    { class: 'coordinator' },
  );
  await attempt(
    authority,
    transcriptPath,
    'R3-3-wake-envelope-mismatch',
    'wake',
    [
      ev(
        'wake.requested',
        {
          wakeId: 'wake-1',
          reason: 'input',
          subject: { type: 'turn', turnId: 'turn-1' },
          sourceEventId: 'evt-act-1',
          requiredSequence: 1,
        },
        { subject: { type: 'turn', turnId: 'turn-9' } },
      ),
    ],
    { class: 'authority' },
  );
  await attempt(
    authority,
    transcriptPath,
    'R3-4-message-self-parent',
    'message',
    [
      ev(
        'message.committed',
        {
          messageId: 'msg-1',
          role: 'assistant',
          contentRef: ref(),
          modelAttemptId: null,
          parentMessageId: 'msg-1',
        },
        { subject: actSubject },
      ),
    ],
    HOLDS,
  );
  await attempt(
    authority,
    transcriptPath,
    'R3-4-config-revision-not-after',
    'bindConfig',
    [
      ev('config.bound', {
        revision: 1,
        previousRevision: 1,
        bundleRef: ref(),
        rootSnapshotRef: ref(),
      }),
    ],
    { class: 'trusted_entry' },
  );
  await attempt(
    authority,
    transcriptPath,
    'R3-4-checkpoint-self-predecessor',
    'checkpoint',
    [
      ev(
        'checkpoint.committed',
        {
          checkpointId: 'cp-1',
          coveredSequence: 1,
          previousCheckpointId: 'cp-1',
          stateRef: ref(),
          boundary: null,
        },
        { subject: actSubject },
      ),
    ],
    HOLDS,
  );
  // Control: a well-formed message after all of that.
  await attempt(
    authority,
    transcriptPath,
    'control-message',
    'message',
    [
      ev(
        'message.committed',
        {
          messageId: 'msg-2',
          role: 'assistant',
          contentRef: ref(),
          modelAttemptId: null,
          parentMessageId: null,
        },
        { subject: actSubject },
      ),
    ],
    HOLDS,
  );
  console.log(`RESULT\t${label}\treadback-same-build\t${await readBack(transcriptPath)}`);
  await authority.close();
  console.log(`TRANSCRIPT\t${transcriptPath}`);
} else if (scenario === 'read') {
  console.log(`RESULT\t${label}\tread\t${a1.split('/').slice(-6, -4).join('/')}\t${await readBack(a1)}`);
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
