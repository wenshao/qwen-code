/**
 * Probe (not for commit): PR #13375 x main #13291 (M5b) interaction.
 *
 * Mirrors main's own M5b case "reads no git branch when a restore has nothing
 * to re-record", changing only the size of the already-recorded tool output.
 * The recorder's tool_result record lands before the close; a reopen runs
 * recoverCommittedReceipts(). It must not record the same call a second time.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openManagedSession } from './managed-session-assembly.js';
import { LocalManagedSessionAuthority } from './managed-session-authority.js';
import { LocalManagedRuntimeOutcomes } from './managed-runtime-outcomes.js';
import { ManagedSessionMessageProjection } from './managed-session-message-projection.js';

const roots = new Set<string>();
afterEach(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  roots.clear();
});

async function resource(value: string) {
  return {
    resourceId: `ref-${value}`,
    kind: value,
    schemaVersion: 1,
    byteLength: Buffer.byteLength(value),
    digest: createHash('sha256').update(value).digest('hex'),
  };
}

async function openSession(root: string, id: string) {
  const runtimeBaseDir = path.join(root, 'runtime');
  const transcriptPath = path.join(runtimeBaseDir, 'chats', `${id}.jsonl`);
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  const lease = await LocalManagedSessionAuthority.acquireWriter({
    runtimeBaseDir,
    sessionId: id,
    transcriptPath,
  });
  const session = await openManagedSession({
    runtimeBaseDir,
    sessionId: id,
    transcriptPath,
    sessionKey: { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionId: id },
    cwd: root,
    version: 'test',
    workerId: 'worker-a',
    activationLeaseDurationMs: 60_000,
    lease,
    create: {
      definitionRef: await resource('definition'),
      rootSnapshotRef: await resource('root'),
      createdBy: 'test',
    },
  });
  return {
    session,
    seal: async () => {
      await session.close();
      await session.releaseActivation();
      const proof = session.authority.commitProof;
      await lease.sealForHandoff({
        last_commit_sequence: proof.lastCommitSequence,
        committed_prefix_hash: proof.committedPrefixHash,
      });
    },
  };
}

const CASES = [
  { name: 'small', output: 'the answer' },
  { name: 'ascii-70k', output: 'x'.repeat(70_000) },
  { name: 'cjk-30k', output: '长'.repeat(30_000) },
];

describe('PROBE m5b restore vs chunked tool_result', () => {
  for (const c of CASES) {
    it(`case=${c.name}`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-probe-'));
      roots.add(root);
      const id = `session-${c.name}`;
      let recordBytes = 0;
      let storedKinds: string[] = [];
      {
        const { session, seal } = await openSession(root, id);
        const outcomes = new LocalManagedRuntimeOutcomes(session);
        await outcomes.admit({
          functionCallId: 'call-a',
          toolName: 'read_file',
          promptId: 'prompt-a',
          params: {},
          toolDefinition: { name: 'read_file', parametersJsonSchema: {} },
          workerIncarnation: 'incarnation-a',
        });
        await outcomes.settle({
          functionCallId: 'call-a',
          executionStatus: 'success',
          payload: {
            executionStatus: 'success',
            responseParts: [{ type: 'text', text: c.output }],
          },
        });
        const record = {
          ...session.authority.recordEnvelope,
          uuid: 'recorded-result:call-a',
          parentUuid: null,
          sessionId: session.authority.sessionHeader.sessionKey.sessionId,
          timestamp: new Date().toISOString(),
          type: 'tool_result',
          message: {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call-a',
                  name: 'read_file',
                  response: { output: c.output },
                },
              },
            ],
          },
          toolCallResult: {
            callId: 'call-a',
            status: 'success',
            responseParts: [{ text: c.output }],
          },
        };
        recordBytes = Buffer.byteLength(JSON.stringify(record));
        // The recorder's record landed before the close.
        await session.sink.write(record as never);
        storedKinds = session.authority
          .eventsInSequenceRange(1, session.authority.committedSequence)
          .filter(
            (e) =>
              e.kind === 'message.committed' &&
              e.payload['role'] === 'tool_result',
          )
          .map((e) => (e.payload['contentRef'] as { kind: string }).kind);
        await seal();
      }
      const { session: restored } = await openSession(root, id);
      try {
        await new LocalManagedRuntimeOutcomes(
          restored,
        ).recoverCommittedReceipts();
        const toolResults = restored.authority
          .eventsInSequenceRange(1, restored.authority.committedSequence)
          .filter(
            (e) =>
              e.kind === 'message.committed' &&
              e.payload['role'] === 'tool_result',
          );
        const history = (await new ManagedSessionMessageProjection(
          restored.authority,
          restored.resources,
        ).project()) as unknown as Array<Record<string, unknown>>;
        const responsesForCallA = (history ?? []).flatMap((r) =>
          (
            ((r['message'] as { parts?: unknown[] } | undefined)?.parts ??
              []) as Array<{ functionResponse?: { id?: string } }>
          ).filter((p) => p.functionResponse?.id === 'call-a'),
        ).length;
        await fs.appendFile(
          process.env['PROBE_OUT_FILE'] ?? path.join(os.tmpdir(), 'probe-m5b.txt'),
          `PROBE_RESULT case=${c.name} recordBytes=${recordBytes} storedKind=${storedKinds.join(',')} toolResultEvents=${toolResults.length} messageIds=${toolResults.map((e) => e.payload['messageId']).join('|')} historyFunctionResponsesForCallA=${history === undefined ? 'n/a' : responsesForCallA}\n`,
        );
        expect(toolResults).toHaveLength(1);
      } finally {
        await restored.close();
      }
    });
  }
});
