// Real Tool v3 host for PR #12821 built from the worktree's compiled dist.
// Usage: node host.mjs <config.json>
// config: { repo, root, command, workerId?, storeFault?: {slowMs?, failAtOrdinal?},
//           crash?: 'before-accept', port? }
// Prints one line "READY <origin>" on stdout; SIGTERM performs the documented
// close order (executor -> server -> store -> session -> activation -> authority).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const repo = config.repo;
const dist = (p) => import(pathToFileURL(path.join(repo, p)).href);
const express = createRequire(path.join(repo, 'package.json'))('express');

const { LocalManagedSessionAuthority } = await dist('packages/core/dist/src/managed-runtime/managed-session-authority.js');
const { LocalManagedSessionResourceStore } = await dist('packages/core/dist/src/managed-runtime/managed-session-resources.js');
const { LocalToolResultSegmentStore } = await dist('packages/core/dist/src/managed-runtime/local-managed-tool-result-store.js');
const { openManagedSession } = await dist('packages/core/dist/src/managed-runtime/managed-session-assembly.js');
const { createManagedHarnessHandle } = await dist('packages/core/dist/src/managed-runtime/managed-harness-factory.js');
const { createNextTurnReadyHarnessCheckpoint, encodeHarnessCheckpointV1 } = await dist('packages/core/dist/src/managed-runtime/managed-harness-checkpoint.js');
const { LocalShellResultSession } = await dist('packages/core/dist/src/managed-runtime/local-shell-result-session.js');
const { createManagedToolSet, ManagedToolExecutor } = await dist('packages/cli/dist/src/serve/managed-runtime-tool-executor.js');
const { registerManagedRuntimeToolV3Routes } = await dist('packages/cli/dist/src/serve/managed-runtime-tool-v3-routes.js');

const sessionKey = { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionId: 'session-a' };
const root = config.root;
const workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { recursive: true });
const command = config.command;
const argsDigest = createHash('sha256').update(JSON.stringify({ command })).digest('hex');

const runtimeBaseDir = path.join(root, 'runtime');
const transcriptPath = path.join(runtimeBaseDir, 'chats', 'session-a.jsonl');
await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
const lease = await LocalManagedSessionAuthority.acquireWriter({ runtimeBaseDir, sessionId: sessionKey.sessionId, transcriptPath });
const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
const realStore = await LocalToolResultSegmentStore.openWritable({ lease, sessionKey });

// Optional storage fault injection around the real O1b store.
const fault = config.storeFault ?? {};
const faultLog = [];
const store = {
  async publish(request) {
    if (fault.slowMs) await new Promise((r) => setTimeout(r, fault.slowMs));
    if (fault.failAtOrdinal !== undefined && request.streamId === 'stdout' && request.ordinal >= fault.failAtOrdinal) {
      faultLog.push(`publish refused stdout#${request.ordinal}`);
      return { status: 'error', code: 'storage_failed' };
    }
    if (process.env.TRACE) faultLog.push(`pub ${request.streamId}#${request.ordinal} len=${request.bytes.length} t=${Date.now()%100000}`);
    const o = await realStore.publish(request).catch((e) => ({ status: 'threw', message: String(e) }));
    if (o.status !== 'ok') faultLog.push(`publish ${request.streamId}#${request.ordinal} -> ${JSON.stringify(o)}`);
    return o;
  },
  async seal(r) {
    if (process.env.TRACE) faultLog.push(`seal-req ${r.streamId} count=${r.segmentCount} len=${r.byteLength}`);
    const o = await realStore.seal(r).catch((e) => ({ status: 'threw', message: String(e) }));
    if (o.status !== 'ok') faultLog.push(`seal ${r.streamId} -> ${JSON.stringify(o)}`);
    return o;
  },
  prefix: (r) => realStore.prefix(r),
  readRange: (r) => realStore.readRange(r),
  close: () => realStore.close(),
};

const session = await openManagedSession({
  runtimeBaseDir, sessionId: sessionKey.sessionId, transcriptPath, sessionKey, cwd: root,
  version: 'pr12821-e2e', workerId: config.workerId ?? 'worker-a', activationLeaseDurationMs: 120_000,
  lease, resourceStore: resources,
  create: {
    definitionRef: await resources.publish('managed-definition', Buffer.from('{}')),
    rootSnapshotRef: await resources.publish('managed-root', Buffer.from('{}')),
    createdBy: 'pr12821-e2e',
  },
});
const harness = createManagedHarnessHandle(session);
await harness.ensureRunnable();
const commandIdentity = (operation, commandId) => ({ operation, commandId, sessionKey, contentDigest: '9'.repeat(64) });
const turnResult = await resources.publish('managed-turn-result', Buffer.from('{"state":"completed"}'));
await session.authority.commitTurnComplete(
  commandIdentity('settleTurn', 'settle-a'),
  {
    turn: { turnId: 'turn-a', outcome: 'completed', stopReason: 'end_turn', resultRef: turnResult, occurredAt: 1, eventId: 'turn:a' },
    boundary: 'turn_complete',
    state: (checkpointIdentity, previous) => encodeHarnessCheckpointV1(createNextTurnReadyHarnessCheckpoint({
      previous, ...checkpointIdentity, activationId: session.activation.activationId, turnId: 'turn-a', promptId: 'turn-a',
    })),
  },
  { class: 'harness', activation: session.activation },
);
const argsRef = await resources.publish('managed-tool-args', Buffer.from(JSON.stringify({ command })));
const definitionRef = await resources.publish('managed-tool-definition', Buffer.from('{}'));
await session.authority.appendExecutionEvent(
  commandIdentity('recordToolIntent', 'intent-a'),
  (sequence) => ({
    v: 1, sequence, eventId: 'intent:a', sessionKey, kind: 'tool.intent', occurredAt: 1,
    subject: { type: 'activation', scopeId: session.activation.activationId, activationId: session.activation.activationId, epoch: session.activation.epoch },
    payload: { executionCallId: 'execution-a', batchId: 'batch-a', ordinal: 0, toolDefinitionRef: definitionRef, argsRef, outcomeSource: 'runtime' },
  }),
  { class: 'harness', activation: session.activation },
);
await harness.commitAwaitRuntime({
  functionCallId: 'call-a', toolName: 'run_shell_command', executionCallId: 'execution-a',
  invocationBindingId: 'binding-a', capabilityVersion: 'cap-a', policyVersion: 'policy-a', mediaVersion: null,
  modelMessageId: 'model-a', partIndex: 0, ordinal: 0, inputDigest: argsDigest, progressCursor: null,
  attemptId: 'attempt-a', routeRef: await resources.publish('managed-route', Buffer.from('{}')),
});

const publisher = new LocalShellResultSession(session, store, '1', lease, 'runtime-session-a');
const toolSet = createManagedToolSet(workspace, 'runtime-session-a');
const executor = new ManagedToolExecutor(async () => toolSet, config.crash === 'before-accept'
  ? {
      prepare: (request) => publisher.prepare(request),
      accept: async () => {
        await fs.writeFile(path.join(root, 'host-killed-before-accept'), String(Date.now()));
        process.kill(process.pid, 'SIGKILL');
        throw new Error('unreachable');
      },
    }
  : publisher);

const app = express();
// Small inspection endpoint for the driver (not part of the product surface).
app.get('/_probe/checkpoint', async (_req, res) => {
  const { parseHarnessCheckpointV1 } = await dist('packages/core/dist/src/managed-runtime/managed-harness-checkpoint.js');
  const checkpoint = parseHarnessCheckpointV1(await session.authority.readCheckpointState());
  const events = session.authority.eventsInSequenceRange(1, session.authority.committedSequence)
    .map((e) => `${e.sequence}:${e.kind}`);
  res.json({ phase: checkpoint.continuation.phase, events, faultLog });
});
registerManagedRuntimeToolV3Routes(app, { token: 'test-token', leaseId: 'lease-a', epoch: 1 }, executor);
const server = createServer(app);
await new Promise((resolve) => server.listen(config.port ?? 0, '127.0.0.1', resolve));
process.stdout.write(`READY http://127.0.0.1:${server.address().port} argsDigest=${argsDigest}\n`);

process.once('SIGTERM', async () => {
  await executor.close();
  await new Promise((resolve) => server.close(() => resolve()));
  await store.close();
  await session.close();
  await session.releaseActivation();
  await session.authority.close();
  process.stdout.write('CLOSED\n');
  process.exit(0);
});
