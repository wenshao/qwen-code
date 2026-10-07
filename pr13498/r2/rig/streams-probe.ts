// For each real (tenant, session, sequence) that both streams use, the journal
// envelope must not be a redelivery of a notice naming the public stream.
import fs from 'node:fs';
import { isManagedEventEnvelopeRedelivered, managedEventEnvelopeFrom, managedEventEnvelopeKey, parseManagedEventEnvelope } from '../src/managed-runtime/managed-event-envelope.js';
import { parseManagedSessionEvent } from '../src/managed-runtime/managed-session-records.js';
let journal = 0, streamOk = 0, collisions = 0, notRedelivered = 0, publicRefused = 0, keyHasStream = 0;
for (let i = 2; i < process.argv.length; i += 2) {
  const dump = JSON.parse(fs.readFileSync(process.argv[i], 'utf8'));
  const pub = new Set(fs.readFileSync(process.argv[i + 1], 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')).filter((c) => c[0] === 'public_event').map((c) => `${c[1]}|${c[2]}|${c[3]}`));
  for (const tx of dump.tx) for (const line of Buffer.from(tx.recordHex, 'hex').toString('utf8').split('\n')) {
    if (!line.includes('"managed_session_event_v1"')) continue;
    const env = managedEventEnvelopeFrom(parseManagedSessionEvent(JSON.parse(line).managedSession));
    journal++;
    if (env.stream === 'authoritative_journal') streamOk++;
    if ('stream' in managedEventEnvelopeKey(parseManagedEventEnvelope(JSON.parse(JSON.stringify(env))))) keyHasStream++;
    if (!pub.has(`${env.tenantId}|${env.sessionId}|${env.sequence}`)) continue;
    collisions++;
    const publicNotice = { ...JSON.parse(JSON.stringify(env)), stream: 'public_event' };
    try { parseManagedEventEnvelope(publicNotice); } catch { publicRefused++; }
    if (!isManagedEventEnvelopeRedelivered(env, publicNotice)) notRedelivered++;
  }
}
console.log(JSON.stringify({ journalEnvelopes: journal, streamIsJournal: streamOk, keyCarriesStream: keyHasStream, sameKeyInPublicStream: collisions, publicNoticeRefusedByV1: publicRefused, notTreatedAsRedelivery: notRedelivered }, null, 1));
