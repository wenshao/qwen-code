// Successor host: node reader.mjs <repo> <root> [manifestRefJson]
// Takes the Session writer lease as a new worker, opens the O1b store read-only,
// and checks the retained bytes against the generator's own digests.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, root, manifestArg] = process.argv.slice(2);
const dist = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { LocalManagedSessionAuthority } = await dist('packages/core/dist/src/managed-runtime/managed-session-authority.js');
const { LocalManagedSessionResourceStore } = await dist('packages/core/dist/src/managed-runtime/managed-session-resources.js');
const { LocalToolResultSegmentStore } = await dist('packages/core/dist/src/managed-runtime/local-managed-tool-result-store.js');
const { openManagedSession } = await dist('packages/core/dist/src/managed-runtime/managed-session-assembly.js');
const { parseHarnessCheckpointV1 } = await dist('packages/core/dist/src/managed-runtime/managed-harness-checkpoint.js');
const { parseToolResultManifestBytes } = await dist('packages/core/dist/src/managed-runtime/managed-tool-result.js');
const { LocalShellResultSession } = await dist('packages/core/dist/src/managed-runtime/local-shell-result-session.js');

const sessionKey = { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionId: 'session-a' };
const runtimeBaseDir = path.join(root, 'runtime');
const transcriptPath = path.join(runtimeBaseDir, 'chats', 'session-a.jsonl');
const out = { successorPid: process.pid };
const lease = await LocalManagedSessionAuthority.acquireWriter({ runtimeBaseDir, sessionId: sessionKey.sessionId, transcriptPath });
const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
const session = await openManagedSession({
  runtimeBaseDir, sessionId: sessionKey.sessionId, transcriptPath, sessionKey, cwd: root,
  version: 'pr12821-e2e', workerId: 'worker-b', activationLeaseDurationMs: 60_000, lease, resourceStore: resources,
});
const store = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir, sessionKey });
const publisher = new LocalShellResultSession(session, store, '1', lease, 'runtime-session-a');
const checkpoint = parseHarnessCheckpointV1(await session.authority.readCheckpointState());
out.checkpointPhase = checkpoint.continuation.phase;
out.events = session.authority.eventsInSequenceRange(1, session.authority.committedSequence).map((e) => `${e.sequence}:${e.kind}`);
const gen = JSON.parse(await fs.readFile(path.join(root, 'gen-digest.json'), 'utf8').catch(() => 'null'));
const captureId = createHash('sha256').update(JSON.stringify([sessionKey, 'execution-a', '1'])).digest('hex').slice(0, 32);
for (const streamId of ['stdout', 'stderr']) {
  const p = await store.prefix({ captureId, streamId });
  out[`prefix_${streamId}`] = p.status === 'ok' ? { ...p.result, matchesGenerator: gen ? p.result.digest === gen[streamId].digest && p.result.byteLength === gen[streamId].byteLength : null } : p;
}
if (manifestArg) {
  const manifestRef = JSON.parse(manifestArg);
  const manifest = parseToolResultManifestBytes(await resources.read(manifestRef));
  const identity = Object.fromEntries(['tenantId', 'sessionId', 'turnId', 'executionCallId', 'callId', 'invocationDigest', 'bindingGeneration', 'captureId', 'revision'].map((k) => [k, manifest[k]]));
  out.manifest = { executionStatus: manifest.executionStatus, exitCode: manifest.exitCode, signal: manifest.signal, captureStatus: manifest.captureStatus, captureReason: manifest.captureReason };
  const recorded = await publisher.recorded(identity).catch((e) => `ERR ${e.message}`);
  out.recorded = recorded && typeof recorded === 'object' ? { deliveryStatus: recorded.deliveryStatus, historyRevision: recorded.historyRevision } : recorded;
  for (const entry of manifest.contents) {
    const hash = createHash('sha256');
    let read = 0;
    for (let offset = 0; offset < entry.byteLength; offset += 1024 * 1024) {
      const r = await store.readRange({ manifestRef, expectedIdentity: identity, streamId: entry.streamId, offset, length: Math.min(1024 * 1024, entry.byteLength - offset) });
      if (r.status !== 'ok') { out[`read_${entry.streamId}`] = r; break; }
      hash.update(r.result); read += r.result.length;
    }
    const digest = hash.digest('hex');
    const g = gen?.[entry.streamId];
    out[`reread_${entry.streamId}`] = {
      state: entry.state, manifestBytes: entry.byteLength, rereadBytes: read,
      rereadDigestMatchesManifest: digest === entry.digest,
      generatorBytes: g?.byteLength ?? null,
      rereadDigestMatchesGenerator: g ? digest === g.digest : null,
    };
    if (entry.streamId === 'stdout' && entry.byteLength >= 5 && g?.tailHex) {
      const t = await store.readRange({ manifestRef, expectedIdentity: identity, streamId: 'stdout', offset: entry.byteLength - 5, length: 5 });
      out.stdoutTail5 = { read: t.result?.toString('hex'), generator: g.tailHex };
    }
  }
}
const invocationDigest = checkpoint.tools?.items.find((i) => i.executionCallId === 'execution-a')?.inputDigest;
out.rePrepare = await publisher.prepare({
  reference: { sessionId: 'runtime-session-a', promptId: 'turn-a', callId: 'call-a', argsDigest: invocationDigest },
  capture: { tenantId: 'tenant-a', sessionId: 'session-a', turnId: 'turn-a', executionCallId: 'execution-a', bindingGeneration: '1', capturePolicy: 'complete_required' },
}).then(() => 'ACCEPTED (unexpected)', (e) => `rejected: ${e.message}`);
const sideEffects = (await fs.readFile(path.join(root, 'side-effects.log'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length;
out.sideEffectRuns = sideEffects;
await store.close();
await session.close();
await session.releaseActivation().catch(() => {});
await session.authority.close();
console.log(JSON.stringify(out, null, 2));
