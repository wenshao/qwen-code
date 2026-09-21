// Shared fixtures for PR #12302 round-3 probes. Every probe imports the BUILT
// artifact of one arm: <arm>/packages/core/dist/src/managed-runtime/managed-session-records.js
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadArm(root) {
  const file = path.join(
    root,
    'packages/core/dist/src/managed-runtime/managed-session-records.js',
  );
  return import(pathToFileURL(file).href);
}

export const key = () => ({
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
});

export const ref = (kind = 'blob') => ({
  resourceId: 'res-1',
  kind,
  schemaVersion: 1,
  byteLength: 128,
  digest: 'a'.repeat(64),
});

const activation = () => ({
  type: 'activation',
  scopeId: 'scope-1',
  activationId: 'act-1',
  epoch: 1,
});

const NEEDS_ACTIVATION = new Set([
  'model.attempt',
  'message.committed',
  'tool.intent',
  'context.compacted',
  'checkpoint.committed',
]);

export const PAYLOADS = {
  'input.accepted': () => ({
    inputId: 'in-1',
    turnId: 'turn-1',
    source: 'cli',
    contentRef: ref(),
    deadline: null,
    admissionRef: ref(),
  }),
  'wake.requested': () => ({
    wakeId: 'wake-1',
    reason: 'timer',
    subject: { type: 'turn', turnId: 'turn-1' },
    sourceEventId: 'ev-0',
    requiredSequence: 1,
  }),
  'activation.changed': () => ({
    activationId: 'act-1',
    epoch: 1,
    workerId: 'worker-1',
    subject: { type: 'turn', turnId: 'turn-1' },
    phase: 'active',
    leaseDurationMs: 30000,
    expiresAt: 1700000030000,
    installRef: ref(),
    boundaryRef: null,
  }),
  'model.attempt': () => ({
    attemptId: 'att-1',
    routeRef: ref(),
    inputCheckpointRef: null,
    state: 'started',
    usageRef: null,
  }),
  'message.committed': () => ({
    messageId: 'msg-1',
    role: 'assistant',
    contentRef: ref(),
    modelAttemptId: 'att-1',
    parentMessageId: null,
  }),
  'tool.intent': () => ({
    executionCallId: 'call-1',
    batchId: 'batch-1',
    ordinal: 0,
    toolDefinitionRef: ref(),
    argsRef: ref(),
    outcomeSource: 'executor',
  }),
  'action.changed': () => ({
    requestId: 'req-1',
    kind: 'approval',
    source: 'tool_call',
    inputRevision: 0,
    optionsRef: null,
    state: 'requested',
    decisionRef: null,
  }),
  'tool.receipt': () => ({
    executionCallId: 'call-1',
    toolOutcomeRef: ref(),
    resultRef: null,
    resources: [ref()],
    historyRevision: 1,
  }),
  'checkpoint.committed': () => ({
    checkpointId: 'cp-1',
    coveredSequence: 1,
    previousCheckpointId: null,
    stateRef: ref(),
    boundary: null,
  }),
  'context.compacted': () => ({
    compactionId: 'cmp-1',
    fromSequence: 1,
    toSequence: 2,
    summaryRef: ref(),
    replacedMessageIds: ['msg-1', 'msg-2'],
    tokenCountsRef: null,
  }),
  'cancel.requested': () => ({
    requestId: 'req-1',
    target: { turnId: 'turn-1' },
    reason: 'user',
    requestedBy: 'user',
  }),
  'turn.settled': () => ({
    turnId: 'turn-1',
    outcome: 'completed',
    stopReason: null,
    resultRef: null,
    usageRef: null,
    pendingOwnersRef: null,
  }),
  'config.bound': () => ({
    revision: 1,
    previousRevision: null,
    bundleRef: ref(),
    rootSnapshotRef: ref(),
  }),
  'lifecycle.changed': () => ({
    operationId: 'op-1',
    from: null,
    to: 'idle',
    reason: 'created',
    pendingOwnersRef: null,
  }),
  'domain.committed': () => ({
    domain: 'goal_state',
    version: 1,
    operationId: 'op-1',
    recordRef: ref('managed-goal_state'),
  }),
};

export function event(kind, payloadPatch = {}, extra = {}) {
  return {
    v: 1,
    sequence: 1,
    eventId: 'ev-1',
    sessionKey: key(),
    kind,
    occurredAt: 1700000000000,
    ...(NEEDS_ACTIVATION.has(kind) ? { subject: activation() } : {}),
    payload: { ...PAYLOADS[kind](), ...payloadPatch },
    ...extra,
  };
}

export function header(patch = {}) {
  return {
    formatVersion: 1,
    minimumReader: 'managed-session/1',
    engine: 'managed',
    sessionKey: key(),
    definitionRef: ref(),
    rootSnapshotRef: ref(),
    createdBy: 'creator-1',
    ...patch,
  };
}

export function commit(patch = {}) {
  return {
    transactionId: 'tx-1',
    commandId: 'cmd-1',
    operation: 'append',
    contentDigest: 'b'.repeat(64),
    firstSequence: 1,
    lastSequence: 1,
    eventCount: 1,
    eventsDigest: 'c'.repeat(64),
    previousCommitDigest: null,
    ...patch,
  };
}

/** Runs fn and classifies the outcome without ever throwing. */
export function verdict(mod, fn) {
  try {
    const value = fn();
    return { v: 'ACCEPT', value };
  } catch (error) {
    const typed = error instanceof mod.ManagedSessionRecordError;
    return {
      v: typed ? 'REJECT' : 'CRASH',
      errorName: error?.constructor?.name ?? typeof error,
      message: String(error?.message ?? error),
    };
  }
}
