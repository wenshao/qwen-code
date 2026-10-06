// Verification probe (not part of the PR): two renewals of the same
// activation requested concurrently. Copied into the mutation worktree,
// run on the clean head and on mutant M05 (hold ignores renewalSeq).
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { it, expect } from 'vitest';
import { SessionWriterLease } from '../services/session-writer-lease.js';
import { Storage } from '../config/storage.js';
import { LocalJsonlManagedSessionJournalStore } from './local-jsonl-managed-session-journal-store.js';
import { LocalManagedSessionResourceStore } from './managed-session-resources.js';
import { LocalManagedSessionAuthority } from './managed-session-authority.js';

const DIGEST = 'a'.repeat(64);
const ref = (kind: string) => ({ resourceId: 'res-1', kind, schemaVersion: 1, byteLength: 4, digest: DIGEST });

it('PROBE concurrent renewals of one activation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-probe-renew-'));
  const runtimeBaseDir = path.join(root, 'runtime');
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(runtimeBaseDir, { recursive: true });
  const sessionId = 'probe-session';
  const transcriptPath = path.join(new Storage(projectRoot, runtimeBaseDir).getProjectDir(), 'chats', `${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  const sessionKey = { tenantId: 't', workspaceId: 'w', sessionId };
  const lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId, transcriptPath });
  const journal = LocalJsonlManagedSessionJournalStore.fromLease(lease, sessionKey);
  const authority = await LocalManagedSessionAuthority.open({
    journal, sessionKey, cwd: '/workspace', version: 'test', now: () => 1_000_000,
    resources: LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey }),
    create: { definitionRef: ref('managed-definition'), rootSnapshotRef: ref('managed-root'), createdBy: 'daemon' },
  });
  await authority.installActivation({ activationId: 'act-1', workerId: 'worker-1', leaseDurationMs: 60_000 });
  const before = authority.committedSequence;
  const settled = await Promise.allSettled([authority.renewActivation({ leaseDurationMs: 60_000 }), authority.renewActivation({ leaseDurationMs: 60_000 })]);
  const outcome = settled.map((s) => (s.status === 'fulfilled' ? (s.value === undefined ? 'undefined' : `renewalSeq=${(s.value as { renewalSeq?: number }).renewalSeq}`) : `REJECTED ${(s.reason as Error).message}`));
  let third: string;
  try { const r = await authority.renewActivation({ leaseDurationMs: 60_000 }); third = r === undefined ? 'undefined' : `renewalSeq=${(r as { renewalSeq?: number }).renewalSeq}`; } catch (e) { third = `REJECTED ${(e as Error).message}`; }
  const line = `PROBE-RESULT concurrent=${JSON.stringify(outcome)} committedDelta=${authority.committedSequence - before} thirdRenewal=${third}`;
  console.log(line);
  await fs.appendFile('/Users/wenshao/git/pr13332-rig/results/concurrent-renewal.txt', `${process.env.PROBE_ARM}\t${line}\n`);
  await lease.release().catch(() => undefined);
  expect(true).toBe(true);
});
