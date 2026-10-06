// Rogue-writer probe for PR 13355 (commit-time validation): the real TypeScript authority
// creates a Managed Session through a real Spring Session Store, a second
// writer holding a valid writer token commits ONE crafted transaction over
// raw HTTP, then a fresh authority reopens the Session exactly as the Hosted
// Harness does (openManagedSession over createHttpManagedSessionStores).
//
// usage: node rogue.mjs <springBaseUrl> <arm> <scenario|all> [resultsFile]
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CORE = '/Users/wenshao/git/pr13355-head/packages/core/dist/src';
const { createHttpManagedSessionStores } = await import(
  `${CORE}/managed-runtime/http-managed-session-store.js`
);
const { openManagedSession } = await import(
  `${CORE}/managed-runtime/managed-session-assembly.js`
);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS, MANAGED_SESSION_ENABLED_DOMAINS } = await import(
  `${CORE}/managed-runtime/managed-session-records.js`
);
const { managedToolDigest } = await import(
  `${CORE}/tools/managed-tool-protocol.js`
);

const [base, arm, which, resultsFile] = process.argv.slice(2);
const TENANT = 'tenant-13355';
const WORKSPACE = 'ws-13355';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function openFaithful(key, create) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'r13355-'));
  const stores = createHttpManagedSessionStores({
    baseUrl: base,
    sessionKey: key,
    writerId: `harness-${randomUUID().slice(0, 8)}`,
    leaseDurationMs: 5_000,
  });
  const refs = create
    ? {
        definitionRef: await stores.resourceStore.publish(
          'managed-definition',
          Buffer.from(JSON.stringify({ engine: 'managed', sessionId: key.sessionId })),
        ),
        rootSnapshotRef: await stores.resourceStore.publish(
          'managed-root',
          Buffer.from(JSON.stringify({ cwd })),
        ),
        createdBy: 'hosted-harness',
      }
    : undefined;
  return openManagedSession({
    runtimeBaseDir: cwd,
    transcriptPath: '',
    sessionId: key.sessionId,
    sessionKey: key,
    cwd,
    version: 'hosted-harness/1',
    workerId: 'probe-worker',
    activationLeaseDurationMs: 5_000,
    journalStore: stores.journalStore,
    resourceStore: stores.resourceStore,
    ...(refs ? { create: refs, requireNew: true } : { retainVerifiedResources: true }),
  });
}

async function http(key, token, p, method, body) {
  const url = `${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(key.sessionId)}${p}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Qwen-Tenant-Id': key.tenantId,
      'X-Qwen-Managed-Writer-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function envelope(key, subtype, body, parentUuid) {
  return {
    uuid: randomUUID(),
    parentUuid,
    sessionId: key.sessionId,
    timestamp: new Date().toISOString(),
    type: 'system',
    subtype,
    cwd: '/workspace',
    version: 'rogue/1',
    managedSession: body,
  };
}

// The faithful template: a kind with no activation-subject rule and no
// resource references, so the control isolates the one mutated line.
function delta(key, sequence, extra = {}) {
  return {
    v: 1,
    sequence,
    eventId: `rogue-cancel-${sequence}-${randomUUID().slice(0, 6)}`,
    sessionKey: key,
    kind: 'cancel.requested',
    occurredAt: Date.now(),
    payload: { requestId: `req-${sequence}`, target: { turnId: 't-rogue' }, reason: 'probe', requestedBy: 'rogue' },
    ...extra,
  };
}

function goalRef(bytes) {
  return {
    resourceId: `goal-${randomUUID()}`,
    kind: 'managed-goal_state',
    schemaVersion: 1,
    byteLength: bytes.length,
    digest: sha256(bytes),
  };
}

// A checkpoint.committed the way the Harness writes one, under the
// activation the faithful open installed.
function checkpoint(key, seq, coveredSequence) {
  const bytes = Buffer.from('{"checkpoint":"probe"}');
  const ref = { resourceId: `ckpt-${randomUUID()}`, kind: 'managed-tool-args', schemaVersion: 1, byteLength: bytes.length, digest: sha256(bytes) };
  return {
    events: [{
      ...delta(key, seq), kind: 'checkpoint.committed',
      subject: { type: 'activation', scopeId: 'probe-scope', activationId: 'probe-activation', epoch: 1 },
      payload: { checkpointId: `ckpt-${seq}`, coveredSequence, previousCheckpointId: null, stateRef: ref, boundary: null },
    }],
    resources: [[ref, bytes]],
  };
}
// The shared chain's first Monitor revision as a faithful domain.committed,
// its args resource committed alongside so the authority can extend it.
const MONITOR = JSON.parse(readFileSync('/Users/wenshao/git/pr13355-head/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json', 'utf8')).monitorChainCases[0].revisions;
function monitorStart(key, seq, eventId) {
  const args = Buffer.from('{"monitor":"probe"}');
  const argsRef = { resourceId: `args-${randomUUID()}`, kind: 'managed-tool-args', schemaVersion: 1, byteLength: args.length, digest: sha256(args) };
  const body = Buffer.from(JSON.stringify({ ...MONITOR[0].monitorRun, commandRef: argsRef }));
  const ref = { resourceId: `mon-${randomUUID()}`, kind: 'managed-monitor_run', schemaVersion: 1, byteLength: body.length, digest: sha256(body) };
  return {
    events: [{ ...delta(key, seq), kind: 'domain.committed', eventId,
      payload: { domain: 'monitor_run', version: 1, operationId: `op-${seq}`, recordRef: ref } }],
    resources: [[argsRef, args], [ref, body]],
    followUp: { argsRef },
  };
}

// Each scenario returns { lines: [managedSession bodies or raw records],
// resources?, marker? overrides }. A body is wrapped as an event record; a
// value with `raw` is used as the whole record line.
const SCENARIOS = {
  control: (key, seq) => ({ events: [delta(key, seq)] }),
  'no-envelope': (key, seq) => ({
    events: [delta(key, seq), { raw: { subtype: 'managed_session_event_v1' } }],
  }),
  'wrong-sequence': (key, seq) => ({
    events: [delta(key, seq), delta(key, seq + 5)],
  }),
  'unknown-kind': (key, seq) => ({
    events: [{ ...delta(key, seq), kind: 'not_a_kind', payload: {} }],
  }),
  'unknown-subtype': (key, seq) => ({
    events: [delta(key, seq), { raw: { subtype: 'not_a_subtype' } }],
  }),
  'unknown-domain': (key, seq) => {
    const bytes = Buffer.from('{}');
    const ref = goalRef(bytes);
    return {
      events: [{
        ...delta(key, seq), kind: 'domain.committed', eventId: `other-${seq}`,
        payload: { domain: 'not_a_domain', version: 1, operationId: 'op-x', recordRef: { ...ref, kind: 'managed-not_a_domain' } },
      }],
      resources: [[{ ...ref, kind: 'managed-not_a_domain' }, bytes]],
    };
  },
  'bodyless-extra-field': (key, seq) => {
    const bytes = Buffer.from('{}');
    const ref = goalRef(bytes);
    return {
      events: [{
        ...delta(key, seq), kind: 'domain.committed', eventId: `goal-${seq}`,
        payload: { domain: 'goal_state', version: 1, operationId: 'op-g', recordRef: ref, extra: true },
      }],
      resources: [[ref, bytes]],
    };
  },
  'bodyless-version-2': (key, seq) => {
    const bytes = Buffer.from('{}');
    const ref = goalRef(bytes);
    return {
      events: [{
        ...delta(key, seq), kind: 'domain.committed', eventId: `goal-${seq}`,
        payload: { domain: 'goal_state', version: 2, operationId: 'op-g', recordRef: ref },
      }],
      resources: [[ref, bytes]],
    };
  },
  'reserved-event-id': (key, seq) => ({
    events: [{ ...delta(key, seq), eventId: 'monitor_run:1' }],
  }),
  // ---- residue probes (outside the envelope half the PR mirrors) ----
  'payload-empty-turn-settled': (key, seq) => ({
    events: [{ ...delta(key, seq), kind: 'turn.settled', payload: {} }],
  }),
  'payload-wrong-type': (key, seq) => ({
    events: [{ ...delta(key, seq), payload: { requestId: 'r', target: {}, reason: 42, requestedBy: 'rogue' } }],
  }),
  'delta-without-activation-subject': (key, seq) => ({
    events: [{ ...delta(key, seq), kind: 'message.delta', payload: { messageId: 'm-rogue', turnId: 't-rogue', role: 'assistant', text: 'hi' } }],
  }),
  'subject-malformed': (key, seq) => ({
    events: [{ ...delta(key, seq), subject: { bogus: true } }],
  }),
  'record-sessionId-mismatch': (key, seq) => ({
    events: [delta(key, seq)],
    recordSessionId: 'someone-else',
  }),
  'marker-extra-field': (key, seq) => ({
    events: [delta(key, seq)],
    markerExtra: { note: 'x' },
  }),
  'marker-wrong-eventsDigest': (key, seq) => ({
    events: [delta(key, seq)],
    markerOverride: { eventsDigest: 'f'.repeat(64) },
  }),
  // The PR's envelope closedness on an ordinary event (mutant M13 survives).
  'event-extra-field': (key, seq) => ({ events: [{ ...delta(key, seq), extra: 1 }] }),
  // The PR's own-Session rule on an ordinary event (mutant M15 survives).
  'event-other-session': (key, seq) => ({
    events: [{ ...delta(key, seq), sessionKey: { ...key, sessionId: 'another-session' } }],
  }),
  // ---- R1-1 (2), (7), (8), (9) and duplicate IDs ----
  'payload-absent': (key, seq) => {
    const e = delta(key, seq);
    delete e.payload;
    return { events: [e] };
  },
  'two-markers': (key, seq) => ({
    events: [{ raw: { subtype: 'managed_session_commit_v1', sessionId: key.sessionId, managedSession: { note: 'stray marker' } } }],
  }),
  'duplicate-event-id': (key, seq) => {
    const a = delta(key, seq), b = delta(key, seq + 1);
    b.eventId = a.eventId;
    return { events: [a, b] };
  },
  'checkpoint-control': (key, seq, g) => checkpoint(key, seq, g.committedSequence),
  'checkpoint-covers-itself': (key, seq) => checkpoint(key, seq, seq),
  'stageh-control': (key, seq) => monitorStart(key, seq, 'monitor_run:1'),
  'stageh-wrong-ordinal': (key, seq) => monitorStart(key, seq, 'monitor_run:2'),
  'marker-broken-chain': (key, seq) => ({
    events: [delta(key, seq)],
    markerOverride: { previousCommitDigest: 'e'.repeat(64) },
    requestMatchesMarker: false,
  }),
  // ---- #13355: the claimed refusals, and the payload rule the flatten dropped ----
  'payload-numeric': (key, seq) => ({ events: [{ ...delta(key, seq), payload: 42 }] }),
  'payload-null': (key, seq) => ({ events: [{ ...delta(key, seq), payload: null }] }),
  'payload-string': (key, seq) => ({ events: [{ ...delta(key, seq), payload: 'x' }] }),
  'payload-array': (key, seq) => ({ events: [{ ...delta(key, seq), payload: [] }] }),
  'subject-numeric': (key, seq) => ({ events: [{ ...delta(key, seq), subject: 42 }] }),
  'domain-missing': (key, seq) => {
    const bytes = Buffer.from('{}');
    const ref = goalRef(bytes);
    return {
      events: [{ ...delta(key, seq), kind: 'domain.committed', eventId: `goal-${seq}`,
        payload: { version: 1, operationId: 'op-g', recordRef: ref } }],
      resources: [[ref, bytes]],
    };
  },
  'domain-numeric': (key, seq) => {
    const bytes = Buffer.from('{}');
    const ref = goalRef(bytes);
    return {
      events: [{ ...delta(key, seq), kind: 'domain.committed', eventId: `goal-${seq}`,
        payload: { domain: 42, version: 1, operationId: 'op-g', recordRef: ref } }],
      resources: [[ref, bytes]],
    };
  },
  'stageh-cross-domain-id': (key, seq) => monitorStart(key, seq, 'child_run:1'),
  'stageh-two-lines': (key, seq) => {
    const a = monitorStart(key, seq, 'monitor_run:1');
    const b = monitorStart(key, seq + 1, 'monitor_run:2');
    return { events: [...a.events, ...b.events], resources: [...a.resources, ...b.resources], followUp: a.followUp };
  },
  // Revision 1 and revision 2 of one Monitor in a single transaction.
  'stageh-two-revisions': (key, seq) => {
    const a = monitorStart(key, seq, 'monitor_run:1');
    const argsRef = a.followUp.argsRef;
    const body = Buffer.from(JSON.stringify({ ...MONITOR[1].monitorRun, commandRef: argsRef }));
    const ref = { resourceId: `mon2-${randomUUID()}`, kind: 'managed-monitor_run', schemaVersion: 1, byteLength: body.length, digest: sha256(body) };
    const second = { ...delta(key, seq + 1), kind: 'domain.committed', eventId: 'monitor_run:2',
      payload: { domain: 'monitor_run', version: 1, operationId: `op-${seq + 1}`, recordRef: ref } };
    return { events: [...a.events, second], resources: [...a.resources, [ref, body]], followUp: a.followUp };
  },
  'marker-over-cap': (key, seq) => ({ events: [delta(key, seq)], markerExtra: { pad: 'x'.repeat(70 * 1024) } }),
  'unknown-subtype-leading': (key, seq) => ({
    events: [{ raw: { subtype: 'not_a_subtype' } }, delta(key, seq + 1)],
  }),
  'unknown-subtype-marker-place': (key, seq) => ({
    events: [delta(key, seq)],
    markerReplacement: { subtype: 'not_a_subtype' },
  }),
  'repeated-header': (key, seq) => ({
    events: [delta(key, seq), { raw: { subtype: 'managed_session_header_v1', sessionId: key.sessionId, managedSession: { v: 1 } } }],
  }),
};

let lastSpec;
async function rogue(key, name) {
  const token = `rogue${randomUUID().replaceAll('-', '')}`;
  const writerId = `rogue-${randomUUID().slice(0, 8)}`;
  const grant = await http(key, token, '/writers:acquire', 'POST', {
    workspaceId: WORKSPACE, writerId, leaseMillis: 30_000,
  });
  if (grant.status !== 200) throw new Error(`acquire ${grant.status} ${JSON.stringify(grant.json)}`);
  const g = grant.json;
  const seq = g.committedSequence + 1;
  const spec = SCENARIOS[name](key, seq, g);
  lastSpec = spec;
  let parent = null;
  const records = [];
  const events = [];
  for (const e of spec.events) {
    if (e.raw) { records.push(e.raw); continue; }
    const r = envelope(key, 'managed_session_event_v1', e, parent);
    if (spec.recordSessionId) r.sessionId = spec.recordSessionId;
    parent = r.uuid;
    records.push(r);
    events.push(e);
  }
  const eventCount = spec.events.length;
  let eventsDigest;
  try { eventsDigest = managedSessionEventsDigest(events); } catch { eventsDigest = sha256('fallback'); }
  const commandId = `rogue-${name}-${randomUUID().slice(0, 8)}`;
  const marker = {
    transactionId: randomUUID(),
    commandId,
    operation: 'rogue.append',
    contentDigest: sha256(commandId),
    firstSequence: seq,
    lastSequence: seq + eventCount - 1,
    eventCount,
    eventsDigest,
    previousCommitDigest: g.lastCommitDigest,
    ...(spec.markerOverride ?? {}),
    ...(spec.markerExtra ?? {}),
  };
  let commitDigest;
  try { commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes); } catch { commitDigest = sha256(JSON.stringify(marker)); }
  if (spec.markerReplacement) records.push(spec.markerReplacement);
  else records.push(envelope(key, 'managed_session_commit_v1', marker, parent));
  const bytes = Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const body = {
    workspaceId: WORKSPACE,
    writerId,
    writerGeneration: g.writerGeneration,
    expectedJournalRevision: g.journalRevision,
    expectedCommittedSequence: g.committedSequence,
    transactionId: marker.transactionId,
    operation: marker.operation,
    commandId,
    contentDigest: marker.contentDigest,
    firstSequence: seq,
    lastSequence: seq + eventCount - 1,
    eventCount,
    eventsDigest: spec.markerOverride?.eventsDigest ?? eventsDigest,
    previousCommitDigest: g.lastCommitDigest,
    commitDigest,
    activationEpoch: g.activationEpoch,
    latestCheckpointResourceId: null,
    recordCount: records.length,
    recordBytesBase64: bytes.toString('base64'),
    recordDigest: sha256(bytes),
    resources: (spec.resources ?? []).map(([ref, b]) => ({
      ...ref, bytesBase64: b.toString('base64'),
    })),
  };
  const commit = await http(key, token, '/transactions:commit', 'POST', body);
  await http(key, token, '/writers:seal', 'POST', {
    workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration,
  });
  return commit;
}

async function runScenario(name) {
  const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId: `r13355-${name}-${randomUUID().slice(0, 8)}` };
  const created = await openFaithful(key, true);
  await created.close();
  const commit = await rogue(key, name);
  let reopen;
  try {
    const again = await openFaithful(key, false);
    reopen = 'OPENED';
    if (name === 'stageh-control' || name === 'stageh-wrong-ordinal') {
      if (!MANAGED_SESSION_ENABLED_DOMAINS.includes('monitor_run')) MANAGED_SESSION_ENABLED_DOMAINS.push('monitor_run');
      const record = { ...MONITOR[1].monitorRun, commandRef: lastSpec.followUp.argsRef };
      try {
        const r = await again.authority.commitExtensionRecord(
          { operation: 'commitExtensionRecord', commandId: 'monitor-revision-2', sessionKey: key, contentDigest: sha256(JSON.stringify(record)) },
          { domain: 'monitor_run', record }, { class: 'trusted_entry' });
        reopen += ` +revision 2 COMMITTED as ${r.receipt.firstSequence}`;
      } catch (error) {
        reopen += ` +revision 2 REFUSED: ${error.message}`;
      }
    }
    if (name === 'reserved-event-id') {
      // What the squatted ID costs: the Monitor chain's first revision is
      // the authority's own monitor_run:1. monitor_run is enabled in this
      // probe's process only (H3 preview), as the Harness preview does.
      if (!MANAGED_SESSION_ENABLED_DOMAINS.includes('monitor_run')) MANAGED_SESSION_ENABLED_DOMAINS.push('monitor_run');
      const fixtures = JSON.parse(readFileSync('/Users/wenshao/git/pr13355-head/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json', 'utf8'));
      const argsRef = await again.resources.publish('managed-tool-args', Buffer.from('{"monitor":"probe"}'));
      const record = { ...fixtures.monitorChainCases[0].revisions[0].monitorRun, commandRef: argsRef };
      try {
        const r = await again.authority.commitExtensionRecord(
          { operation: 'commitExtensionRecord', commandId: 'monitor-after-squat', sessionKey: key, contentDigest: sha256(JSON.stringify(record)) },
          { domain: 'monitor_run', record }, { class: 'trusted_entry' });
        reopen += ` +monitor_run:1 COMMITTED at ${r.receipt.firstSequence}`;
      } catch (error) {
        reopen += ` +monitor_run:1 REFUSED: ${error.message}`;
      }
    }
    await again.close();
  } catch (error) {
    reopen = `REFUSED: ${error instanceof Error ? error.message : String(error)}`;
  }
  const row = {
    arm, scenario: name, sessionId: key.sessionId,
    commit: commit.status, code: commit.json?.code ?? commit.json?.error?.code ?? null,
    message: (commit.json?.message ?? commit.json?.error?.message ?? '').slice(0, 160),
    reopen: reopen.slice(0, 220),
  };
  console.log(`RESULT\t${row.arm}\t${row.scenario}\tcommit=${row.commit}\t${row.code ?? '-'}\t${row.reopen.split(':')[0]}\t${row.message}\t${row.reopen}`);
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify(row) + '\n');
}

const names = which === 'all' ? Object.keys(SCENARIOS) : which.split(',');
for (const n of names) {
  try { await runScenario(n); } catch (e) { console.log(`RESULT\t${arm}\t${n}\tERROR\t${e.stack}`); }
}
