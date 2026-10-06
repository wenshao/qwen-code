// Runs the PR's envelope contract over journal rows committed by a real
// Managed stack (Spring Session Store on MySQL 8.4.7, Hosted Harness, CLI).
// usage: tsx probe/real-rows-probe.ts <journal.json>... > result.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line import/no-internal-modules
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  isManagedEventEnvelopeRedelivered,
  managedEventEnvelopeFrom,
  managedEventEnvelopeKey,
  parseManagedEventEnvelope,
} from '../src/managed-runtime/managed-event-envelope.js';
import {
  MANAGED_SESSION_EVENT_KINDS,
  managedSessionEventsDigest,
  parseManagedSessionCommitMarker,
  parseManagedSessionEvent,
  type ManagedSessionEvent,
} from '../src/managed-runtime/managed-session-records.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  fs.readFileSync(
    path.join(
      here,
      '../src/managed-runtime/contracts/managed-event-envelope-v1.schema.json',
    ),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: true });
ajv.compile(schema);
const validateEnvelope = ajv.getSchema(`${schema.$id}#/$defs/envelope`)!;

interface TxRow {
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  journalRevision: number;
  operation: string;
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  eventsDigest: string | null;
  createdAt: string;
  recordHex: string;
}

const failures: string[] = [];
const kinds: Record<string, number> = {};
const txSizes: Record<string, number> = {};
const keys = new Map<string, string>();
let events = 0;
let singleEventDigestMatches = 0;
let singleEventTx = 0;
let multiEventTx = 0;
let multiEventPerEventDigestEqualsColumn = 0;
let roundTrips = 0;
let schemaAccepted = 0;
let sessionKeyMatchesColumns = 0;
let markerMatchesColumn = 0;
let occurredBeforeCommit = 0;
let maxCommitLagMs = 0;
let occurredAtInversions = 0;
const inversionExamples: string[] = [];
let envelopesWithAbsolutePath = 0;
let recordLinesWithAbsolutePath = 0;
const sources: Record<string, number> = {};

for (const file of process.argv.slice(2)) {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8')) as { tx: TxRow[] };
  sources[path.basename(file)] = dump.tx.length;
  let previous: ManagedSessionEvent | undefined;
  for (const tx of dump.tx) {
    const lines = Buffer.from(tx.recordHex, 'hex')
      .toString('utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const txEvents: ManagedSessionEvent[] = [];
    let marker: ReturnType<typeof parseManagedSessionCommitMarker> | undefined;
    for (const line of lines) {
      if (/\/(Users|home|private|tmp|var)\//.test(JSON.stringify(line))) {
        recordLinesWithAbsolutePath++;
      }
      if (line.subtype === 'managed_session_event_v1') {
        txEvents.push(parseManagedSessionEvent(line.managedSession));
      } else if (line.subtype === 'managed_session_commit_v1') {
        marker = parseManagedSessionCommitMarker(line.managedSession);
      }
    }
    if (tx.eventCount === 0) continue;
    txSizes[tx.eventCount] = (txSizes[tx.eventCount] ?? 0) + 1;
    if (txEvents.length !== tx.eventCount) {
      failures.push(`rev ${tx.journalRevision}: decoded ${txEvents.length} events, column says ${tx.eventCount}`);
    }
    if (marker?.eventsDigest === tx.eventsDigest) markerMatchesColumn++;
    else failures.push(`rev ${tx.journalRevision}: marker digest != column`);
    if (managedSessionEventsDigest(txEvents) !== tx.eventsDigest) {
      failures.push(`rev ${tx.journalRevision}: recomputed tx digest != column`);
    }
    // created_at is written in the server's local zone (+08:00 on this host).
    const commitMs = Date.parse(`${tx.createdAt}+08:00`);
    for (const event of txEvents) {
      events++;
      kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
      if (
        event.sessionKey.tenantId === tx.tenantId &&
        event.sessionKey.workspaceId === tx.workspaceId &&
        event.sessionKey.sessionId === tx.sessionId
      ) {
        sessionKeyMatchesColumns++;
      } else {
        failures.push(`seq ${event.sequence}: sessionKey differs from row columns`);
      }
      const envelope = managedEventEnvelopeFrom(event);
      const wire = JSON.parse(JSON.stringify(envelope));
      const parsed = parseManagedEventEnvelope(wire);
      if (JSON.stringify(parsed) === JSON.stringify(envelope)) roundTrips++;
      else failures.push(`seq ${event.sequence}: round trip differs`);
      if (validateEnvelope(wire)) schemaAccepted++;
      else failures.push(`seq ${event.sequence}: schema refused ${JSON.stringify(validateEnvelope.errors)}`);
      if (/\/(Users|home|private|tmp|var)\//.test(JSON.stringify(wire))) {
        envelopesWithAbsolutePath++;
      }
      if (tx.eventCount === 1) {
        if (envelope.payloadRef.digest === tx.eventsDigest) singleEventDigestMatches++;
        else failures.push(`seq ${event.sequence}: single-event digest != events_digest`);
      } else if (envelope.payloadRef.digest === tx.eventsDigest) {
        multiEventPerEventDigestEqualsColumn++;
      }
      if (!isManagedEventEnvelopeRedelivered(wire, JSON.parse(JSON.stringify(envelope)))) {
        failures.push(`seq ${event.sequence}: identical redelivery not recognised`);
      }
      const key = JSON.stringify(managedEventEnvelopeKey(parsed));
      if (keys.has(key) && keys.get(key) !== envelope.payloadRef.digest) {
        failures.push(`key ${key} names two different events`);
      }
      keys.set(key, envelope.payloadRef.digest);
      if (event.occurredAt <= commitMs) occurredBeforeCommit++;
      maxCommitLagMs = Math.max(maxCommitLagMs, commitMs - event.occurredAt);
      if (
        previous &&
        previous.sessionKey.sessionId === event.sessionKey.sessionId &&
        event.occurredAt < previous.occurredAt
      ) {
        occurredAtInversions++;
        if (inversionExamples.length < 3) {
          inversionExamples.push(
            `${file.includes('failover') ? 'failover' : 'model'} seq ${previous.sequence}->${event.sequence} (${previous.kind}->${event.kind}): occurredAt ${previous.occurredAt}->${event.occurredAt} (${event.occurredAt - previous.occurredAt} ms)`,
          );
        }
      }
      if (previous && previous.sessionKey.sessionId === event.sessionKey.sessionId) {
        if (isManagedEventEnvelopeRedelivered(wire, managedEventEnvelopeFrom(previous))) {
          failures.push(`seq ${event.sequence}: neighbour treated as redelivery`);
        }
      }
      previous = event;
    }
    if (tx.eventCount === 1) singleEventTx++;
    else multiEventTx++;
  }
}

console.log(
  JSON.stringify(
    {
      sources,
      events,
      distinctKeys: keys.size,
      kindsSeen: Object.keys(kinds).length,
      kindsOfSeventeen: kinds,
      kindsNeverSeen: MANAGED_SESSION_EVENT_KINDS.filter((k) => !(k in kinds)),
      transactionsByEventCount: txSizes,
      singleEventTx,
      multiEventTx,
      sessionKeyMatchesColumns,
      markerMatchesColumn,
      roundTrips,
      schemaAccepted,
      singleEventDigestMatches,
      multiEventPerEventDigestEqualsColumn,
      occurredBeforeCommit,
      maxCommitLagMs,
      occurredAtInversions,
      inversionExamples,
      recordLinesWithAbsolutePath,
      envelopesWithAbsolutePath,
      failures,
    },
    null,
    2,
  ),
);
