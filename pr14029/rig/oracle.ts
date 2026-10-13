// Oracle: re-derive every committed event's envelope with the TypeScript
// frozen contract from the SQL rows, and compare it byte-for-byte with what
// the broker delivered to the session LiteTopic.
// usage: tsx oracle.ts <rows.tsv: session_id \t revision \t hex(record_bytes)> <received.jsonl> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import {
  managedEventEnvelopeFrom,
  parseManagedEventEnvelope,
} from '/Users/wenshao/git/pr14029-head/packages/core/src/managed-runtime/managed-event-envelope.ts';
import { parseManagedSessionEvent } from '/Users/wenshao/git/pr14029-head/packages/core/src/managed-runtime/managed-session-records.ts';

// verbatim copy of the (unexported) canonicalManagedSessionJson
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const [rowsPath, receivedPath, outPath] = process.argv.slice(2);
const expected = new Map<string, any>();
const kinds: Record<string, number> = {};
let lines = 0, eventLines = 0, otherSubtypes: Record<string, number> = {};
for (const row of readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean)) {
  const [sessionId, revision, hex] = row.split('\t');
  const text = Buffer.from(hex, 'hex').toString('utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    lines++;
    const record = JSON.parse(line);
    if (record.subtype !== 'managed_session_event_v1') {
      otherSubtypes[record.subtype] = (otherSubtypes[record.subtype] ?? 0) + 1;
      continue;
    }
    eventLines++;
    const event = parseManagedSessionEvent(record.managedSession);
    const envelope = managedEventEnvelopeFrom(event);
    kinds[envelope.kind] = (kinds[envelope.kind] ?? 0) + 1;
    expected.set(envelope.eventId, { sessionId, revision: Number(revision), envelope, canonical: canonical(envelope) });
  }
}
const received = readFileSync(receivedPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byKey = new Map<string, any[]>();
for (const m of received) {
  const list = byKey.get(m.keys) ?? [];
  list.push(m);
  byKey.set(m.keys, list);
}
const result: any = { journalLines: lines, eventLines, otherSubtypes, kinds, expectedEvents: expected.size, receivedMessages: received.length,
  byteIdentical: 0, tsParseAccepts: 0, liteTopicIsSession: 0, keyIsEventId: 0, missing: [], duplicates: [], mismatches: [], unexpected: [] };
for (const [eventId, exp] of expected) {
  const got = byKey.get(eventId);
  if (!got) { result.missing.push({ eventId, kind: exp.envelope.kind, sequence: exp.envelope.sequence }); continue; }
  if (got.length > 1) result.duplicates.push({ eventId, count: got.length });
  const m = got[0];
  if (m.body === exp.canonical) result.byteIdentical++;
  else result.mismatches.push({ eventId, expected: exp.canonical, got: m.body });
  try {
    const parsed = parseManagedEventEnvelope(JSON.parse(m.body));
    if (canonical(parsed) === exp.canonical) result.tsParseAccepts++;
  } catch (e) { result.mismatches.push({ eventId, tsParseError: String(e) }); }
  if (m.liteTopic === exp.envelope.sessionId) result.liteTopicIsSession++;
  if (m.keys === eventId) result.keyIsEventId++;
}
for (const m of received) if (!expected.has(m.keys)) result.unexpected.push(m.keys);
// per-session delivery order vs sequence
const order: Record<string, number[]> = {};
for (const m of received) { const e = expected.get(m.keys); if (e) (order[e.sessionId] ??= []).push(e.envelope.sequence); }
result.deliveryOrderBySession = Object.fromEntries(Object.entries(order).map(([s, seqs]) => [s, { count: seqs.length, inSequenceOrder: seqs.every((v, i) => i === 0 || v > seqs[i - 1]), sequences: seqs }]));
result.sample = [...expected.values()].slice(0, 2).map((e) => e.canonical);
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, sample: undefined, deliveryOrderBySession: undefined, kinds: result.kinds }, null, 0));
