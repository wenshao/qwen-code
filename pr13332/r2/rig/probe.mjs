// Real Session Store probe for PR 13332: one Spring Managed Agent Server
// (Session Store enabled, MySQL 8.4) and the TypeScript authority from the
// chosen arm's built core dist (openManagedSession over
// createHttpManagedSessionStores, exactly as the Hosted Harness wires it).
//
// usage: node probe.mjs <arm: head|base|merge> <scenario|all> [resultsFile]
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [arm, which, resultsFile] = process.argv.slice(2);
const BASE = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:18332';
const R = '/Users/wenshao/git/pr13332-rig';
const DB = process.env.PROBE_DB ?? 'ms13332';
const CORE = `/Users/wenshao/git/pr13332-${arm}/packages/core/dist/src`;
const { createHttpManagedSessionStores } = await import(
  `${CORE}/managed-runtime/http-managed-session-store.js`
);
const { openManagedSession } = await import(
  `${CORE}/managed-runtime/managed-session-assembly.js`
);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS } = await import(
  `${CORE}/managed-runtime/managed-session-records.js`
);
const { projectManagedSessionRecords } = await import(
  `${CORE}/managed-runtime/managed-session-message-projection.js`
);
const { managedToolDigest } = await import(
  `${CORE}/tools/managed-tool-protocol.js`
);
const TENANT = 'tenant-13332';
const WORKSPACE = 'ws-13332';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sql = (q) =>
  execFileSync(`${R}/sql.sh`, [DB, '-N', '-B', '-e', q], {
    encoding: 'utf8',
  }).trim();
const TABLES = [
  'qwen_managed_session_journal_head',
  'qwen_managed_session_journal_tx',
  'qwen_managed_session_resource',
  'qwen_managed_session_resource_ref',
  'qwen_managed_session_extension_record',
];
const MYSQL_BIN = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin';

async function open(key, create) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'p13332-'));
  const stores = createHttpManagedSessionStores({
    baseUrl: BASE,
    sessionKey: key,
    writerId: `harness-${randomUUID().slice(0, 8)}`,
    leaseDurationMs: 60_000,
  });
  const refs = create
    ? {
        definitionRef: await stores.resourceStore.publish(
          'managed-session-definition',
          Buffer.from(JSON.stringify({ model: 'probe', sessionId: key.sessionId })),
        ),
        rootSnapshotRef: await stores.resourceStore.publish(
          'managed-session-root-snapshot',
          Buffer.from('{"version":1,"messages":[]}'),
        ),
        createdBy: 'hosted-harness',
      }
    : undefined;
  const session = await openManagedSession({
    runtimeBaseDir: cwd,
    transcriptPath: '',
    sessionId: key.sessionId,
    sessionKey: key,
    cwd,
    version: 'hosted-harness/1',
    workerId: 'probe-worker',
    activationLeaseDurationMs: 60_000,
    journalStore: stores.journalStore,
    resourceStore: stores.resourceStore,
    ...(refs ? { create: refs, requireNew: true } : { retainVerifiedResources: true }),
  });
  return { session, stores, cwd, refs };
}

function newKey(name) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    sessionId: `p13332-${name}-${randomUUID().slice(0, 8)}`,
  };
}

let cancelCounter = 0;
function cancel(session, key, target) {
  const n = ++cancelCounter;
  return session.authority.appendExecutionEvent(
    {
      operation: 'requestCancel',
      commandId: `cancel-${n}-${randomUUID().slice(0, 6)}`,
      sessionKey: key,
      contentDigest: 'd'.repeat(64),
    },
    (sequence) => ({
      v: 1,
      sequence,
      eventId: `cancel:req-${n}-${randomUUID().slice(0, 6)}`,
      sessionKey: key,
      kind: 'cancel.requested',
      occurredAt: Date.now(),
      payload: { requestId: `req-${n}`, target, reason: 'probe', requestedBy: 'probe' },
    }),
    { class: 'trusted_entry' },
  );
}

function head(key) {
  return sql(
    `SELECT CONCAT(journal_revision,'/',committed_sequence,'/gen',writer_generation) FROM qwen_managed_session_journal_head WHERE session_id='${key.sessionId}'`,
  );
}
function refRows(key) {
  return sql(
    `SELECT IFNULL(GROUP_CONCAT(CONCAT(journal_revision,':',resource_id) ORDER BY journal_revision SEPARATOR ' '),'') FROM qwen_managed_session_resource_ref WHERE session_id='${key.sessionId}'`,
  );
}
const msg = (e) => (e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e));

// A turn_result ChatRecord exactly as the sink receives one from the
// recorder; `omit` drops fields to make it non-reader-facing.
function turnResult(key, cwd, promptId, omit = []) {
  const record = {
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: key.sessionId,
    timestamp: new Date().toISOString(),
    type: 'system',
    cwd,
    version: 'hosted-harness/1',
    subtype: 'turn_result',
    systemPayload: { promptId, state: 'completed', stopReason: 'end_turn', endedAt: Date.now() },
  };
  for (const k of omit) delete record[k];
  return record;
}

function userRecord(key, cwd, text) {
  return {
    uuid: randomUUID(), parentUuid: null, sessionId: key.sessionId,
    timestamp: new Date().toISOString(), type: 'user', cwd,
    version: 'hosted-harness/1', message: { role: 'user', parts: [{ text }] },
  };
}
function compressionRecord(key, cwd) {
  return {
    uuid: randomUUID(), parentUuid: null, sessionId: key.sessionId,
    timestamp: new Date().toISOString(), type: 'system', subtype: 'chat_compression', cwd,
    version: 'hosted-harness/1',
    systemPayload: { info: { originalTokenCount: 100, newTokenCount: 10 }, compressedHistory: [{ role: 'user', parts: [{ text: 'summary of earlier turns' }] }] },
  };
}

// Raw-HTTP writer (a second writer holding a valid token) committing one
// crafted transaction — used where the arm's own authority refuses to write.
async function rawHttp(key, token, p, method, body) {
  const url = `${BASE}/internal/managed-session-store/v1/sessions/${encodeURIComponent(key.sessionId)}${p}`;
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
    uuid: randomUUID(), parentUuid, sessionId: key.sessionId,
    timestamp: new Date().toISOString(), type: 'system', subtype,
    cwd: '/workspace', version: 'rogue/1', managedSession: body,
  };
}
async function rogueCommit(key, makeEvents) {
  const token = `rogue${randomUUID().replaceAll('-', '')}`;
  const writerId = `rogue-${randomUUID().slice(0, 8)}`;
  const grant = await rawHttp(key, token, '/writers:acquire', 'POST', { workspaceId: WORKSPACE, writerId, leaseMillis: 30_000 });
  if (grant.status !== 200) throw new Error(`acquire ${grant.status} ${JSON.stringify(grant.json)}`);
  const g = grant.json;
  const seq = g.committedSequence + 1;
  const events = makeEvents(seq);
  const records = [];
  let parent = null;
  for (const e of events) {
    const r = envelope(key, 'managed_session_event_v1', e, parent);
    parent = r.uuid;
    records.push(r);
  }
  const eventsDigest = managedSessionEventsDigest(events);
  const commandId = `rogue-${randomUUID().slice(0, 8)}`;
  const marker = {
    transactionId: randomUUID(), commandId, operation: 'rogue.append',
    contentDigest: sha256(commandId), firstSequence: seq,
    lastSequence: seq + events.length - 1, eventCount: events.length,
    eventsDigest, previousCommitDigest: g.lastCommitDigest,
  };
  const commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes);
  records.push(envelope(key, 'managed_session_commit_v1', marker, parent));
  const bytes = Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const commit = await rawHttp(key, token, '/transactions:commit', 'POST', {
    workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration,
    expectedJournalRevision: g.journalRevision, expectedCommittedSequence: g.committedSequence,
    transactionId: marker.transactionId, operation: marker.operation, commandId,
    contentDigest: marker.contentDigest, firstSequence: seq,
    lastSequence: marker.lastSequence, eventCount: events.length, eventsDigest,
    previousCommitDigest: g.lastCommitDigest, commitDigest,
    activationEpoch: g.activationEpoch, latestCheckpointResourceId: null,
    recordCount: records.length, recordBytesBase64: bytes.toString('base64'),
    recordDigest: sha256(bytes), resources: [],
  });
  await rawHttp(key, token, '/writers:seal', 'POST', { workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration });
  return commit;
}

async function reopenAndProject(key) {
  let r;
  try {
    const again = await open(key, false);
    try {
      const records = await again.session.sink.project();
      r = `REOPEN ok; hosted projection ${records.length} records`;
    } catch (e) {
      r = `REOPEN ok; hosted projection FAILED ${msg(e)}`;
    }
    // The cold projection the local Managed reader runs (session list,
    // resume), over this same durable journal and resource store.
    try {
      const journal = await again.stores.journalStore.open({ sessionKey: key });
      const scan = await journal.read();
      const records = await projectManagedSessionRecords({ scan, resources: again.stores.resourceStore });
      r += ` | cold projection OK ${records.length} records [${records.map((x) => x.subtype ?? x.type).join(',')}]`;
    } catch (e) {
      r += ` | cold projection FAILED ${msg(e)}`;
    }
    await again.session.close().catch(() => undefined);
  } catch (e) {
    r = `REOPEN FAILED ${msg(e)}`;
  }
  return r;
}

const SCENARIOS = {
  // R1-4 control: an ordinary cancel target.
  'cancel-plain-target': async () => {
    const key = newKey('plain');
    const { session } = await open(key, true);
    let out;
    try {
      await cancel(session, key, { turnId: 't-1' });
      out = `COMMITTED head=${head(key)} refs=[${refRows(key)}]`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-4: a free-form target that merely names the five ref fields.
  'cancel-phantom-ref-target': async () => {
    const key = newKey('phantom');
    const { session } = await open(key, true);
    let out;
    try {
      await cancel(session, key, {
        resourceId: 'not-a-ref', kind: 'not-a-ref-kind', schemaVersion: 1,
        byteLength: 2, digest: 'not-a-digest',
      });
      out = `COMMITTED head=${head(key)} refs=[${refRows(key)}]`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-4: a free-form target naming a real resource of this session.
  'cancel-real-ref-target': async () => {
    const key = newKey('bound');
    const { session, refs } = await open(key, true);
    let out;
    try {
      await cancel(session, key, { ...refs.definitionRef });
      const rev = sql(`SELECT MAX(journal_revision) FROM qwen_managed_session_journal_tx WHERE session_id='${key.sessionId}'`);
      const bound = sql(`SELECT COUNT(*) FROM qwen_managed_session_resource_ref WHERE session_id='${key.sessionId}' AND journal_revision=${rev}`);
      out = `COMMITTED at rev ${rev}; resources bound to that rev=${bound} (definition=${refs.definitionRef.resourceId.slice(0, 8)}) all=[${refRows(key)}]`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-6 control: a reader-facing turn_result through the production sink.
  'sink-turn-result-valid': async () => {
    const key = newKey('tr-ok');
    const { session, cwd } = await open(key, true);
    let out;
    try {
      await session.sink.write(turnResult(key, cwd, 'prompt-1'));
      out = `COMMITTED head=${head(key)}`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-6: a turn_result the cold projection would reject (no cwd).
  'sink-turn-result-no-cwd': async () => {
    const key = newKey('tr-nocwd');
    const { session, cwd } = await open(key, true);
    let out;
    try {
      await session.sink.write(turnResult(key, cwd, 'prompt-1', ['cwd']));
      out = `COMMITTED head=${head(key)}`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    // the session must stay usable for the honest writer afterwards
    try {
      await session.sink.write(turnResult(key, cwd, 'prompt-2'));
      out += ' | follow-up valid turn COMMITTED';
    } catch (e) { out += ` | follow-up REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-6 / R2-1: a well-formed record that belongs to another session.
  'sink-turn-result-other-session': async () => {
    const key = newKey('tr-other');
    const { session, cwd } = await open(key, true);
    let out;
    try {
      const rec = turnResult(key, cwd, 'prompt-1');
      rec.sessionId = 'someone-elses-session';
      await session.sink.write(rec);
      out = `COMMITTED head=${head(key)}`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-1: a schema-legal null resultRef on turn.settled. The arm's own
  // authority first; then a raw second writer commits the same event so the
  // arm's reader faces it either way.
  'turn-settled-null-resultref': async () => {
    const key = newKey('nullref');
    const { session } = await open(key, true);
    let out;
    try {
      await session.authority.appendExecutionEvent(
        { operation: 'settleTurn', commandId: `settle-${randomUUID().slice(0, 6)}`, sessionKey: key, contentDigest: 'e'.repeat(64) },
        (sequence) => ({
          v: 1, sequence, eventId: 'turn:t-null', sessionKey: key, kind: 'turn.settled', occurredAt: Date.now(),
          payload: { turnId: 't-null', outcome: 'completed', stopReason: null, resultRef: null, usageRef: null, pendingOwnersRef: null },
        }),
        { class: 'authority' },
      );
      out = `own authority COMMITTED head=${head(key)}`;
    } catch (e) { out = `own authority REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    if (!out.includes('COMMITTED')) {
      const c = await rogueCommit(key, (seq) => [{
        v: 1, sequence: seq, eventId: 'turn:t-null-raw', sessionKey: key, kind: 'turn.settled', occurredAt: Date.now(),
        payload: { turnId: 't-null', outcome: 'completed', stopReason: null, resultRef: null, usageRef: null, pendingOwnersRef: null },
      }]);
      out += ` | raw second writer commit=${c.status} head=${head(key)}`;
    }
    return { out, reopen: await reopenAndProject(key) };
  },
  // Envelope order: colliding content keys in a domain record.
  'domain-record-colliding-keys': async () => {
    const key = newKey('envelope');
    const { session } = await open(key, true);
    let out;
    try {
      const r = await session.authority.commitDomainRecord(
        { operation: 'renameSession', commandId: 'cmd-rename-collide', sessionKey: key, contentDigest: 'd'.repeat(64) },
        { domain: 'session_metadata', content: { title: 'x', revision: 999, previousRecordRef: 'bogus', operationId: 'caller-chosen' } },
        { class: 'trusted_entry' },
      );
      const stored = sql(`SELECT CAST(inline_bytes AS CHAR CHARACTER SET utf8mb4) FROM qwen_managed_session_resource WHERE session_id='${key.sessionId}' AND resource_id='${r.recordRef.resourceId}'`);
      out = `COMMITTED; durable body in MySQL = ${stored}`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-16: the message.committed channel through the production sink.
  'sink-message-valid': async () => {
    const key = newKey('msg-ok');
    const { session, cwd } = await open(key, true);
    let out;
    try { await session.sink.write(userRecord(key, cwd, 'hello')); out = `COMMITTED head=${head(key)}`; }
    catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  'sink-message-no-cwd': async () => {
    const key = newKey('msg-nocwd');
    const { session, cwd } = await open(key, true);
    let out;
    try { const r = userRecord(key, cwd, 'hello'); delete r.cwd; await session.sink.write(r); out = `COMMITTED head=${head(key)}`; }
    catch (e) { out = `REFUSED ${msg(e)}`; }
    try { await session.sink.write(userRecord(key, cwd, 'follow-up')); out += ' | follow-up valid message COMMITTED'; }
    catch (e) { out += ` | follow-up REFUSED ${msg(e)}`; }
    let closed = 'close() resolved';
    await session.close().catch((e) => { closed = `close() REJECTED ${msg(e)}`; });
    return { out: `${out} | ${closed}`, reopen: await reopenAndProject(key) };
  },
  // be6fb30d: a message over 64 KiB is published as 60 KiB parts + manifest.
  'sink-message-200k-chunked': async () => {
    const key = newKey('msg-big');
    const { session, cwd } = await open(key, true);
    let out;
    try {
      await session.sink.write(userRecord(key, cwd, 'x'.repeat(200 * 1024)));
      const parts = sql(`SELECT CONCAT(kind,':',COUNT(*)) FROM qwen_managed_session_resource WHERE session_id='${key.sessionId}' AND kind LIKE 'managed-message%' GROUP BY kind ORDER BY kind`).replace(/\n/g, ' ');
      out = `COMMITTED head=${head(key)} resources=[${parts}]`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R3-7: the context.compacted channel.
  'sink-compression-valid': async () => {
    const key = newKey('cmp-ok');
    const { session, cwd } = await open(key, true);
    let out;
    try {
      await session.sink.write(userRecord(key, cwd, 'hello'));
      await session.sink.write(compressionRecord(key, cwd));
      out = `COMMITTED head=${head(key)}`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  'sink-compression-no-version': async () => {
    const key = newKey('cmp-nover');
    const { session, cwd } = await open(key, true);
    let out;
    try {
      await session.sink.write(userRecord(key, cwd, 'hello'));
      const r = compressionRecord(key, cwd); delete r.version;
      await session.sink.write(r);
      out = `COMMITTED head=${head(key)}`;
    } catch (e) { out = `REFUSED ${msg(e)}`; }
    await session.close().catch(() => undefined);
    return { out, reopen: await reopenAndProject(key) };
  },
  // R1-3: the server's head genuinely regresses (tables restored from a
  // snapshot taken mid-session), then the same writer reads its journal.
  'regressed-head': async () => {
    const key = newKey('regress');
    const { session, stores } = await open(key, true);
    const lines = [];
    try {
      await cancel(session, key, { turnId: 't-1' });
      await cancel(session, key, { turnId: 't-2' });
      const journal = await stores.journalStore.open({ sessionKey: key });
      const first = await journal.read();
      lines.push(`before snapshot: server head=${head(key)} reader committed=${first.committed}`);
      const snap = path.join(R, 'results', `snap-${arm}.sql`);
      execFileSync('/bin/sh', ['-c', `${MYSQL_BIN}/mysqldump --no-defaults -uroot --socket=${R}/mysql.sock ${DB} ${TABLES.join(' ')} > ${snap}`]);
      await cancel(session, key, { turnId: 't-3' });
      await cancel(session, key, { turnId: 't-4' });
      const writerKnows = session.authority.committedSequence;
      lines.push(`after 2 more commits: server head=${head(key)} authority.committedSequence=${writerKnows}`);
      execFileSync('/bin/sh', ['-c', `${R}/sql.sh ${DB} < ${snap}`]);
      lines.push(`after restoring the snapshot: server head=${head(key)}`);
      try {
        const again = await journal.read();
        lines.push(`same writer read(): RESOLVED committed=${again.committed} (writer had ${writerKnows})`);
      } catch (e) { lines.push(`same writer read(): REJECTED ${msg(e)}`); }
      try {
        await cancel(session, key, { turnId: 't-5' });
        lines.push(`next commit: COMMITTED server head=${head(key)}`);
      } catch (e) { lines.push(`next commit: REFUSED ${msg(e)}`); }
    } catch (e) { lines.push(`ERROR ${msg(e)}`); }
    await session.close().catch(() => undefined);
    return { out: lines.join(' || '), reopen: '-' };
  },
};

const names = which === 'all' ? Object.keys(SCENARIOS).filter((n) => n !== 'regressed-head') : which.split(',');
for (const n of names) {
  let row;
  try {
    const r = await SCENARIOS[n]();
    row = { arm, scenario: n, ...r };
  } catch (e) {
    row = { arm, scenario: n, out: `ERROR ${e.stack}`, reopen: '-' };
  }
  console.log(`RESULT\t${row.arm}\t${row.scenario}\t${row.out}\t${row.reopen}`);
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify(row) + '\n');
}
process.exit(0);
