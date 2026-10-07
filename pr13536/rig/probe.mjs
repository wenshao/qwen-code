// VERIFICATION RIG ONLY (PR #13536): H6a schedule / automation_run records on a real stack.
// The real TypeScript authority (core dist of the chosen arm, openManagedSession over
// createHttpManagedSessionStores) commits through a real Spring Managed Agent Server (Session
// Store) on MySQL 8.4.7. schedule / automation_run are enabled IN THIS PROCESS ONLY (the PR keeps
// them disabled for submission; this mirrors the authority suite's own mock, done on dist).
// A second writer holding a valid writer token commits ONE crafted Stage H line over raw HTTP,
// which isolates the Java store's own commit-time checks; a fresh authority then reopens the
// Session exactly as the Hosted Harness does.
//
// usage: node probe.mjs <springBaseUrl> <arm> <coreDistSrc> <scenario|all> [resultsFile]
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [base, arm, CORE, which, resultsFile] = process.argv.slice(2);
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS, MANAGED_SESSION_ENABLED_DOMAINS } = await import(
  `${CORE}/managed-runtime/managed-session-records.js`);
const { managedToolDigest } = await import(`${CORE}/tools/managed-tool-protocol.js`);
const FX = JSON.parse(readFileSync('/Users/wenshao/git/pr13536-head/packages/core/src/managed-runtime/contracts/managed-automation-record-v1.fixtures.json', 'utf8'));

const TENANT = 'tenant-13536';
const WORKSPACE = 'ws-13536';
const DOMAINS = ['schedule', 'automation_run'];
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const enable = () => { for (const d of DOMAINS) if (!MANAGED_SESSION_ENABLED_DOMAINS.includes(d)) MANAGED_SESSION_ENABLED_DOMAINS.push(d); };
const disable = () => { for (const d of DOMAINS) { const i = MANAGED_SESSION_ENABLED_DOMAINS.indexOf(d); if (i >= 0) MANAGED_SESSION_ENABLED_DOMAINS.splice(i, 1); } };

function merge(baseV, patch) {
  const value = structuredClone(baseV ?? {});
  for (const [k, r] of Object.entries(patch)) {
    value[k] = r !== null && typeof r === 'object' && !Array.isArray(r) ? merge(value[k], r) : r;
  }
  return value;
}
const sched = (patch = {}) => merge(FX.templates.schedule, patch);
const arun = (patch = {}) => merge(FX.templates.automation_run, patch);
const BIND = { runtimeBindingId: 'binding-1', generation: '1' };
const RUN_CHAIN = [
  {},
  { run: { state: 'running', execution: 'intent', effectId: 'effect-1' } },
  { run: { state: 'running', execution: 'dispatch_started', effectId: 'effect-1', runtime: BIND } },
  { run: { state: 'running', execution: 'running_attached', effectId: 'effect-1', runtime: BIND } },
  { run: { state: 'settled', execution: 'settled', effectId: 'effect-1', runtime: BIND, deliveryId: 'delivery-1', delivery: { target: 'channel', state: 'planned' } } },
  { run: { state: 'settled', execution: 'settled', effectId: 'effect-1', runtime: BIND, deliveryId: 'delivery-1', delivery: { target: 'channel', state: 'sending' } } },
  { run: { state: 'settled', execution: 'settled', effectId: 'effect-1', runtime: BIND, deliveryId: 'delivery-1', delivery: { target: 'channel', state: 'delivered' } } },
];
const D9 = '9'.repeat(64), D8 = '8'.repeat(64);
const SCHED_CHAIN = [
  {},
  { run: { state: 'running' }, definitionRevision: 2, definitionDigest: D9 },
  { run: { state: 'running' }, definitionRevision: 3, definitionDigest: D8, cron: '30 8 * * 1-5' },
  { run: { state: 'waiting' }, definitionRevision: 4, definitionDigest: D9, enabled: false },
  { run: { state: 'cancelled' }, definitionRevision: 5, definitionDigest: D8, enabled: false },
];

async function openFaithful(key, create) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'r13536-'));
  const stores = createHttpManagedSessionStores({
    baseUrl: base, sessionKey: key, writerId: `harness-${randomUUID().slice(0, 8)}`, leaseDurationMs: 5_000,
  });
  const refs = create ? {
    definitionRef: await stores.resourceStore.publish('managed-definition',
      Buffer.from(JSON.stringify({ engine: 'managed', sessionId: key.sessionId }))),
    rootSnapshotRef: await stores.resourceStore.publish('managed-root', Buffer.from(JSON.stringify({ cwd }))),
    createdBy: 'hosted-harness',
  } : undefined;
  return openManagedSession({
    runtimeBaseDir: cwd, transcriptPath: '', sessionId: key.sessionId, sessionKey: key, cwd,
    version: 'hosted-harness/1', workerId: 'probe-worker', activationLeaseDurationMs: 5_000,
    journalStore: stores.journalStore, resourceStore: stores.resourceStore,
    ...(refs ? { create: refs, requireNew: true } : { retainVerifiedResources: true }),
  });
}

async function http(key, token, p, method, body) {
  const url = `${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(key.sessionId)}${p}`;
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json',
      'X-Qwen-Tenant-Id': key.tenantId, 'X-Qwen-Managed-Writer-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}
function envelope(key, subtype, body, parentUuid) {
  return { uuid: randomUUID(), parentUuid, sessionId: key.sessionId, timestamp: new Date().toISOString(),
    type: 'system', subtype, cwd: '/workspace', version: 'rogue/1', managedSession: body };
}
const cmd = (key, commandId, operation = 'commitExtensionRecord') =>
  ({ operation, commandId, sessionKey: key, contentDigest: sha256(commandId) });
const TRUSTED = { class: 'trusted_entry' };

// rogue writer: one Stage H line (domain.committed) with its body resource, raw JSON text allowed
async function rogueStageH(key, domain, recordBody, ordinal) {
  const token = `rogue${randomUUID().replaceAll('-', '')}`;
  const writerId = `rogue-${randomUUID().slice(0, 8)}`;
  const grant = await http(key, token, '/writers:acquire', 'POST', { workspaceId: WORKSPACE, writerId, leaseMillis: 30_000 });
  if (grant.status !== 200) throw new Error(`acquire ${grant.status} ${JSON.stringify(grant.json)}`);
  const g = grant.json;
  const seq = g.committedSequence + 1;
  const bytes0 = Buffer.from(typeof recordBody === 'string' ? recordBody : JSON.stringify(recordBody));
  const ref = { resourceId: `rogue-${domain}-${randomUUID()}`, kind: `managed-${domain}`, schemaVersion: 1, byteLength: bytes0.length, digest: sha256(bytes0) };
  const commandId = `rogue-${domain}-${randomUUID().slice(0, 8)}`;
  const event = { v: 1, sequence: seq, eventId: `${domain}:${ordinal}`, sessionKey: key, kind: 'domain.committed',
    occurredAt: Date.now(), payload: { domain, version: 1, operationId: commandId, recordRef: ref } };
  const rec = envelope(key, 'managed_session_event_v1', event, null);
  const eventsDigest = managedSessionEventsDigest([event]);
  const marker = { transactionId: randomUUID(), commandId, operation: 'rogue.append', contentDigest: sha256(commandId),
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest, previousCommitDigest: g.lastCommitDigest };
  const commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes);
  const records = [rec, envelope(key, 'managed_session_commit_v1', marker, rec.uuid)];
  const bytes = Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const body = { workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration,
    expectedJournalRevision: g.journalRevision, expectedCommittedSequence: g.committedSequence,
    transactionId: marker.transactionId, operation: marker.operation, commandId, contentDigest: marker.contentDigest,
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest, previousCommitDigest: g.lastCommitDigest,
    commitDigest, activationEpoch: g.activationEpoch, latestCheckpointResourceId: null, recordCount: records.length,
    recordBytesBase64: bytes.toString('base64'), recordDigest: sha256(bytes),
    resources: [[ref, bytes0]].map(([r, b]) => ({ ...r, bytesBase64: b.toString('base64') })) };
  const commit = await http(key, token, '/transactions:commit', 'POST', body);
  await http(key, token, '/writers:seal', 'POST', { workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration });
  return commit;
}

async function reopen(key) {
  try {
    const s = await openFaithful(key, false);
    const sc = s.authority.extensionRecordsInDomain('schedule').map((r) => `${r.recordId}@${r.revision}`);
    const ar = s.authority.extensionRecordsInDomain('automation_run').map((r) => `${r.recordId}@${r.revision}`);
    const tasks = s.authority.taskViews().map((t) => `${t.kind}/${t.state}/${t.runtimeState}/def=${t.definitionRevision}`);
    await s.close();
    return { status: 'OPENED', sc, ar, tasks };
  } catch (e) {
    return { status: 'REFUSED', error: `${e.constructor.name}: ${e.message}`.slice(0, 300) };
  }
}
const results = [];
function result(scenario, fields) {
  const row = { arm, scenario, ...fields };
  results.push(row);
  console.log(JSON.stringify(row));
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify(row) + '\n');
}
const newKey = (name) => ({ tenantId: TENANT, workspaceId: WORKSPACE, sessionId: `r13536-${name}-${randomUUID().slice(0, 8)}` });
const tv = (s) => s.authority.taskViews().map((t) => `${t.kind}/${t.state}/${t.runtimeState}/def=${t.definitionRevision}/started=${t.startedAt !== null}/settled=${t.settledAt !== null}`).join(',');

const SCENARIOS = {
  // S0: both domains stay refused for submission (no in-process enablement).
  async 'disabled-refused'() {
    disable();
    const key = newKey('disabled');
    const s = await openFaithful(key, true);
    for (const [domain, record] of [['schedule', sched()], ['automation_run', arun()]]) {
      try {
        await s.authority.commitExtensionRecord(cmd(key, `${domain}-x`), { domain, record }, TRUSTED);
        result('disabled-refused', { domain, outcome: 'COMMITTED' });
      } catch (e) { result('disabled-refused', { domain, outcome: 'REFUSED', error: `${e.constructor.name}: ${e.message}`.slice(0, 160) }); }
    }
    await s.close();
  },
  // S1: a faithful Schedule chain and an AutomationRun chain through the real authority + store.
  async 'faithful-chain'() {
    const key = newKey('faithful');
    const s = await openFaithful(key, true);
    enable();
    const promptRef = await s.resources.publish('managed-prompt', Buffer.from('{"prompt":"run the nightly build"}'));
    const views = [];
    for (let i = 0; i < SCHED_CHAIN.length; i++) {
      const r = await s.authority.commitExtensionRecord(cmd(key, `schedule-1:${i + 1}`), { domain: 'schedule', record: sched({ ...SCHED_CHAIN[i], promptRef }) }, TRUSTED);
      views.push({ d: 'schedule', rev: r.revision, taskId: r.taskId ?? null, seq: r.receipt.firstSequence, tasks: tv(s) });
    }
    for (let i = 0; i < RUN_CHAIN.length; i++) {
      const r = await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'automation_run', record: arun(RUN_CHAIN[i]) }, TRUSTED);
      views.push({ d: 'automation_run', rev: r.revision, taskId: r.taskId ? r.taskId.slice(0, 20) : null, seq: r.receipt.firstSequence, tasks: tv(s) });
    }
    // a manual run alongside
    const m = await s.authority.commitExtensionRecord(cmd(key, 'run-2:1'), { domain: 'automation_run',
      record: arun({ automationRunId: 'run-2', occurrenceKey: 'manual:command-7', sessionMode: 'per_run', targetSessionId: null }) }, TRUSTED);
    views.push({ d: 'automation_run', rec: 'run-2', rev: m.revision, tasks: tv(s) });
    const replay = await s.authority.commitExtensionRecord(cmd(key, 'run-1:1'), { domain: 'automation_run', record: arun() }, TRUSTED);
    const refusals = {};
    for (const [name, domain, rec, id] of [
      ['schedule-after-cancel', 'schedule', sched({ run: { state: 'cancelled' }, definitionRevision: 6, definitionDigest: D9, enabled: false, promptRef }), 'schedule-1:6'],
      ['run-reopens-after-settle', 'automation_run', arun(RUN_CHAIN[3]), 'run-1:8'],
      ['run-retarget', 'automation_run', arun({ ...RUN_CHAIN[6], targetSessionId: 'session-2' }), 'run-1:9'],
      ['run-second-claim-same-occurrence', 'automation_run', arun({ automationRunId: 'run-3' }), 'run-3:1'],
    ]) {
      try { const r = await s.authority.commitExtensionRecord(cmd(key, id), { domain, record: rec }, TRUSTED); refusals[name] = `COMMITTED rev ${r.revision}`; }
      catch (e) { refusals[name] = `REFUSED ${e.constructor.name}: ${e.message.slice(0, 110)}`; }
    }
    await s.close();
    disable();
    const again = await reopen(key);
    result('faithful-chain', { sessionId: key.sessionId, views, replay: { rev: replay.revision, replayed: replay.receipt.replayed }, refusals, reopen: again });
    writeFileSync(`/Users/wenshao/git/pr13536-rig/results/faithful-session-${arm}.txt`, key.sessionId);
  },
  // S2: the Java store's own body checks, isolated by a rogue writer (one crafted line each).
  async 'java-body-gate'() {
    const G = (n) => '\\ud83d'.repeat(n);
    const cases = [
      ['control-schedule', 'schedule', sched()],
      ['control-run', 'automation_run', arun()],
      ['webhook-occurrence', 'automation_run', arun({ occurrenceKey: 'webhook:event-1' })],
      ['slot-not-canonical', 'automation_run', arun({ occurrenceKey: 'schedule:2026-10-06T01:00:00.000Z' })],
      ['slot-feb-30', 'automation_run', arun({ occurrenceKey: 'schedule:2026-02-30T01:00:00Z' })],
      ['run-without-dispatch', 'automation_run', arun({ run: { dispatchId: null } })],
      ['delivery-before-end', 'automation_run', arun({ run: { state: 'running', execution: 'intent', effectId: 'effect-1', deliveryId: 'delivery-1', delivery: { target: 'channel', state: 'sending' } } })],
      ['cron-step-zero', 'schedule', sched({ cron: '*/0 * * * *' })],
      ['cron-out-of-range', 'schedule', sched({ cron: '99 99 99 99 99' })],
      ['cron-quartz', 'schedule', sched({ cron: '0 9 ? * 1-5' })],
      ['timezone-space', 'schedule', sched({ timezone: 'Mars/Olympus Mons' })],
      ['schedule-physical-run', 'schedule', sched({ run: { dispatchId: 'claim-1' } })],
      ['catchup-bounded-no-limit', 'schedule', sched({ catchUp: 'bounded' })],
      ['persistent-no-target', 'schedule', sched({ targetSessionId: null })],
    ];
    for (const [name, domain, body] of cases) {
      const key = newKey(`jg-${name}`);
      const s = await openFaithful(key, true); await s.close();
      const commit = await rogueStageH(key, domain, body, 1);
      const again = await reopen(key);
      result('java-body-gate', { case: name, domain, http: commit.status, code: commit.json?.code ?? commit.json?.error ?? null,
        message: (commit.json?.message ?? commit.json?.detail ?? '').slice(0, 120), reopen: again.status, sc: again.sc, ar: again.ar, tasks: again.tasks, err: again.error });
    }
    // surrogate-length boundary through the raw wire (JSON escapes, so both engines see lone surrogates)
    for (const [name, n] of [['goal-1365-lone-surrogates', 1365], ['goal-1366-lone-surrogates', 1366]]) {
      const key = newKey(`jg-${name}`);
      const s = await openFaithful(key, true); await s.close();
      const text = JSON.stringify(sched({ goal: 'GOALSLOT' })).replace('"GOALSLOT"', `"${G(n)}"`);
      const commit = await rogueStageH(key, 'schedule', text, 1);
      const again = await reopen(key);
      result('java-body-gate', { case: name, domain: 'schedule', http: commit.status, code: commit.json?.code ?? commit.json?.error ?? null,
        message: (commit.json?.message ?? '').slice(0, 120), reopen: again.status, sc: again.sc, err: again.error });
    }
  },
  // S3: a raw body (JSON text from RAW env file, one per line "name\tdomain\tjson") through the rogue writer.
  async 'raw-lines'() {
    const lines = readFileSync(process.env.RAW, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const [name, domain, text] = line.split('\t');
      const key = newKey(`raw-${name}`.slice(0, 60));
      const s = await openFaithful(key, true); await s.close();
      const commit = await rogueStageH(key, domain, text, 1);
      const again = await reopen(key);
      result('raw-lines', { case: name, domain, http: commit.status, code: commit.json?.code ?? commit.json?.error ?? null,
        message: (commit.json?.message ?? '').slice(0, 120), reopen: again.status, sc: again.sc, ar: again.ar, err: again.error });
    }
  },

  // S4: where must promptRef live? hosted (HTTP store) vs local file store.
  async 'prompt-scope'() {
    const tryCommit = async (s, key, domain, record, id) => {
      try { const r = await s.authority.commitExtensionRecord(cmd(key, id), { domain, record }, TRUSTED); return `COMMITTED rev ${r.revision}`; }
      catch (e) { return `REFUSED ${e.constructor.name}: ${e.message.slice(0, 120)}`; }
    };
    enable();
    // (a) hosted, promptRef names a resource this Session never published (the fixture's prompt-1)
    {
      const key = newKey('ps-dangling');
      const s = await openFaithful(key, true);
      const first = await tryCommit(s, key, 'schedule', sched(), 'schedule-1:1');
      const next = await tryCommit(s, key, 'automation_run', arun(), 'run-1:1');
      await s.close().catch(() => {});
      result('prompt-scope', { case: 'hosted-dangling', schedule: first, thenAutomationRun: next, reopen: await reopen(key) });
    }
    // (b) hosted, promptRef published into this Session's resource store first
    let foreignRef;
    {
      const key = newKey('ps-local');
      const s = await openFaithful(key, true);
      const promptRef = await s.resources.publish('managed-prompt', Buffer.from('{"prompt":"run the nightly build"}'));
      const first = await tryCommit(s, key, 'schedule', sched({ promptRef }), 'schedule-1:1');
      foreignRef = promptRef;
      await s.close();
      result('prompt-scope', { case: 'hosted-session-local', promptRef: `${promptRef.kind}/${promptRef.resourceId.slice(0, 8)}`, schedule: first, reopen: await reopen(key) });
    }
    // (c) hosted, promptRef names a resource committed in ANOTHER Session (b's prompt)
    {
      const key = newKey('ps-foreign');
      const s = await openFaithful(key, true);
      const first = await tryCommit(s, key, 'schedule', sched({ promptRef: foreignRef }), 'schedule-1:1');
      await s.close().catch(() => {});
      result('prompt-scope', { case: 'hosted-other-session', schedule: first, reopen: await reopen(key) });
    }
    // (d) local file stores (no journalStore / resourceStore supplied), dangling promptRef
    {
      const key = newKey('ps-localfs');
      const cwd = mkdtempSync(path.join(tmpdir(), 'r13536-local-'));
      const open = async (create) => {
        const { LocalManagedSessionResourceStore } = await import(`${CORE}/managed-runtime/managed-session-resources.js`);
        const res = LocalManagedSessionResourceStore.create({ runtimeBaseDir: cwd, sessionKey: key });
        const refs = create ? {
          definitionRef: await res.publish('managed-definition', Buffer.from(JSON.stringify({ engine: 'managed', sessionId: key.sessionId }))),
          rootSnapshotRef: await res.publish('managed-root', Buffer.from(JSON.stringify({ cwd }))),
          createdBy: 'hosted-harness',
        } : undefined;
        return openManagedSession({ runtimeBaseDir: cwd, transcriptPath: path.join(cwd, 'transcript.jsonl'), sessionId: key.sessionId,
          sessionKey: key, cwd, version: 'local/1', workerId: 'probe-worker', activationLeaseDurationMs: 5_000, resourceStore: res,
          ...(refs ? { create: refs, requireNew: true } : { retainVerifiedResources: true }) });
      };
      const s = await open(true);
      const first = await tryCommit(s, key, 'schedule', sched(), 'schedule-1:1');
      const next = await tryCommit(s, key, 'automation_run', arun(), 'run-1:1');
      await s.close();
      let again;
      try { const s2 = await open(false); again = { status: 'OPENED', sc: s2.authority.extensionRecordsInDomain('schedule').map((r) => `${r.recordId}@${r.revision}`), tasks: s2.authority.taskViews().map((t) => `${t.kind}/${t.state}`) }; await s2.close(); }
      catch (e) { again = { status: 'REFUSED', error: `${e.constructor.name}: ${e.message}`.slice(0, 200) }; }
      result('prompt-scope', { case: 'local-file-dangling', schedule: first, thenAutomationRun: next, reopen: again });
    }
    disable();
  },
  // Reopen an existing Session (SESSION env) with this arm's authority.
  async 'reopen-only'() {
    const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId: process.env.SESSION };
    result('reopen-only', { sessionId: key.sessionId, ...(await reopen(key)) });
  },
};

const names = which === 'all' ? ['disabled-refused', 'faithful-chain', 'java-body-gate'] : which.split(',');
for (const n of names) {
  try { await SCENARIOS[n](); }
  catch (e) { result(n, { outcome: 'PROBE-ERROR', error: `${e.constructor.name}: ${e.message}`.slice(0, 400), stack: e.stack?.split('\n').slice(1, 4).join(' | ') }); }
}
process.exit(0);
