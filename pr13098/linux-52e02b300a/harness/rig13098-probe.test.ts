/**
 * Independent verification probe for PR #13098 (guard queued Hosted approval
 * expiry). NOT part of the PR — written by the reviewer to re-exercise the
 * fixed race against a real Session authority, resource store and JSONL
 * journal on real disk, with assertions on the journal bytes themselves.
 *
 * The only simulated element is time/slow-flush: a one-shot gate delays one
 * real journal append (the write still physically lands), which is what a
 * slow Session Store round-trip looks like to the authority's serial queue.
 * The blocked predicate matches the production route's `() => session.blocked`.
 *
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  openManagedSession,
  type ManagedSession,
} from '@qwen-code/qwen-code-core/managed-runtime/managed-session-assembly.js';
import { createManagedHarnessHandle } from '@qwen-code/qwen-code-core/managed-runtime/managed-harness-factory.js';
import { LocalManagedSessionResourceStore } from '@qwen-code/qwen-code-core/managed-runtime/managed-session-resources.js';
import { LocalJsonlManagedSessionJournalHandle } from '@qwen-code/qwen-code-core/managed-runtime/local-jsonl-managed-session-journal-store.js';
import {
  HOSTED_TOOL_APPROVAL_POLICY,
  HostedApprovalWaiters,
  resolveHostedAction,
  type HostedActionOptions,
} from './hosted-tool-approval.js';

let root: string;
let session: ManagedSession;
let harness: ReturnType<typeof createManagedHarnessHandle>;
let waiters: HostedApprovalWaiters;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rig13098-probe-'));
  const sessionKey = {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    sessionId: randomUUID(),
  };
  const resources = LocalManagedSessionResourceStore.create({
    runtimeBaseDir: root,
    sessionKey,
  });
  const definitionRef = await resources.publish(
    'managed-definition',
    Buffer.from('{}'),
  );
  const rootSnapshotRef = await resources.publish(
    'managed-root',
    Buffer.from('{}'),
  );
  session = await openManagedSession({
    runtimeBaseDir: root,
    cwd: root,
    transcriptPath: path.join(root, 'transcript.jsonl'),
    sessionId: sessionKey.sessionId,
    sessionKey,
    version: 'test',
    workerId: 'worker',
    activationLeaseDurationMs: 60_000,
    create: { definitionRef, rootSnapshotRef, createdBy: 'test' },
  });
  harness = createManagedHarnessHandle(session);
  await harness.ensureRunnable();
  waiters = new HostedApprovalWaiters();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await session?.close();
  await rm(root, { recursive: true, force: true });
});

/** Every journal record on disk, parsed from the real .jsonl files. */
async function journalOnDisk(): Promise<Array<Record<string, unknown>>> {
  const files: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.endsWith('.jsonl')) files.push(p);
    }
  }
  await walk(root);
  const records: Array<Record<string, unknown>> = [];
  for (const file of files) {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t) as Record<string, unknown>;
        // Tolerate both bare records and { managedSession: record } wrappers.
        const rec = (parsed['managedSession'] ?? parsed) as Record<
          string,
          unknown
        >;
        if (typeof rec['kind'] === 'string') records.push(rec);
      } catch {
        /* partial line */
      }
    }
  }
  return records;
}

const actionRecords = (
  records: Array<Record<string, unknown>>,
  requestId: string,
) =>
  records.filter(
    (r) =>
      r['kind'] === 'action.changed' &&
      (r['payload'] as Record<string, unknown>)?.['requestId'] === requestId,
  );

/** Requests a real approval Action through the same call the Turn makes. */
async function requestAction(expiresAt: number): Promise<string> {
  const requestId = `tool_approval_${randomUUID().replaceAll('-', '')}`;
  const createdAt = Date.now();
  const options: HostedActionOptions = {
    v: 1,
    requestId,
    turnId: 'prompt',
    functionCallId: 'call-1',
    toolName: 'edit',
    policyRevision: HOSTED_TOOL_APPROVAL_POLICY,
    inputRevision: 1,
    createdAt,
    expiresAt,
    options: [
      { id: 'allow', label: 'Allow' },
      { id: 'deny', label: 'Deny' },
    ],
  };
  const optionsRef = await session.resources.publish(
    'managed-action-options',
    Buffer.from(JSON.stringify(options)),
  );
  const inputRef = await session.resources.publish(
    'managed-tool-input',
    Buffer.from('{}'),
  );
  await harness.commitDurableWait(
    {
      requestId,
      kind: 'permission',
      source: 'tool_call',
      optionsRef,
      inputRevision: '1',
      invocationRef: inputRef,
      attemptId: 'message-1',
      routeRef: inputRef,
    },
    { turnId: 'prompt', promptId: 'prompt' },
  );
  return requestId;
}

const answer = (optionId: string) => ({
  optionId,
  inputRevision: 1,
  policyRevision: HOSTED_TOOL_APPROVAL_POLICY,
});

/**
 * Holds the authority's serial queue with one genuinely delayed real write,
 * runs `whileHeld`, then releases. Returns the held write's promise.
 */
async function withHeldQueue<T>(
  whileHeld: () => Promise<T>,
): Promise<{ held: Promise<unknown>; outcome: T }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const inQueue = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const append =
    LocalJsonlManagedSessionJournalHandle.prototype.appendTransaction;
  vi.spyOn(
    LocalJsonlManagedSessionJournalHandle.prototype,
    'appendTransaction',
  ).mockImplementationOnce(async function (
    this: LocalJsonlManagedSessionJournalHandle,
    records,
  ) {
    entered();
    await gate; // a slow flush; the write below still really appends
    return append.call(this, records);
  });
  const held = session.sink.write({
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: session.authority.sessionHeader.sessionKey.sessionId,
    timestamp: new Date().toISOString(),
    type: 'assistant',
    cwd: root,
    version: 'test',
    message: { role: 'model', parts: [{ text: 'held' }] },
  });
  await inQueue;
  try {
    const outcome = await whileHeld();
    return { held, outcome };
  } finally {
    release();
  }
}

it('P1: a queued late-expiry answer records nothing once the Session blocks', async () => {
  const requestId = await requestAction(Date.now() - 60_000); // already late
  expect(session.authority.action(requestId)?.state).toBe('requested');

  let blocked = false; // the production route's `() => session.blocked`
  const queued = vi.spyOn(session.authority, 'resolveAction');
  const notify = vi.spyOn(waiters, 'notify');
  let answering!: Promise<unknown>;
  const { held } = await withHeldQueue(async () => {
    answering = resolveHostedAction(
      session,
      waiters,
      requestId,
      answer('allow'),
      () => blocked,
    );
    // The answer's expiry write is now queued behind the held write.
    await vi.waitFor(() => expect(queued).toHaveBeenCalled());
    blocked = true; // the Session becomes recovery-blocked mid-queue
  });
  await held;
  await expect(answering).resolves.toEqual({
    status: 409,
    code: 'hosted_turn_recovery_required',
  });

  // In-memory: nothing was admitted, and the journal itself never failed.
  expect(session.authority.action(requestId)?.state).toBe('requested');
  expect(session.authority.writesStopped).toBe(false);
  expect(notify).toHaveBeenCalledWith(requestId);

  // On disk: no expiry record for this Action; the held write really landed.
  const disk = await journalOnDisk();
  const states = actionRecords(disk, requestId).map(
    (r) => (r['payload'] as Record<string, unknown>)['state'],
  );
  expect(states).toEqual(['requested']);
  expect(
    disk.some((r) => JSON.stringify(r).includes('held')),
    'held transcript write landed on disk',
  ).toBe(true);

  // The journal stayed writable throughout: once unblocked, the same late
  // answer takes the ordinary expiry path and records exactly one expiry.
  blocked = false;
  await expect(
    resolveHostedAction(session, waiters, requestId, answer('allow')),
  ).resolves.toEqual({ status: 409, code: 'action_expired' });
  expect(session.authority.action(requestId)?.state).toBe('expired');
  const diskAfter = await journalOnDisk();
  const statesAfter = actionRecords(diskAfter, requestId).map(
    (r) => (r['payload'] as Record<string, unknown>)['state'],
  );
  expect(statesAfter).toEqual(['requested', 'expired']);

  // A recorded outcome replays without a new write.
  await expect(
    resolveHostedAction(session, waiters, requestId, answer('allow')),
  ).resolves.toEqual({ status: 409, code: 'action_expired' });
  expect((await journalOnDisk()).length).toBe(diskAfter.length);
});

it('P2: a queued decision answer records nothing once the Session blocks', async () => {
  const requestId = await requestAction(Date.now() + 60_000); // not late
  expect(session.authority.action(requestId)?.state).toBe('requested');

  let blocked = false;
  const queued = vi.spyOn(session.authority, 'resolveAction');
  let answering!: Promise<unknown>;
  const { held } = await withHeldQueue(async () => {
    answering = resolveHostedAction(
      session,
      waiters,
      requestId,
      answer('allow'),
      () => blocked,
    );
    await vi.waitFor(() => expect(queued).toHaveBeenCalled());
    blocked = true;
  });
  await held;
  await expect(answering).resolves.toEqual({
    status: 409,
    code: 'hosted_turn_recovery_required',
  });
  expect(session.authority.action(requestId)?.state).toBe('requested');
  expect(session.authority.writesStopped).toBe(false);
  const states = actionRecords(await journalOnDisk(), requestId).map(
    (r) => (r['payload'] as Record<string, unknown>)['state'],
  );
  expect(states).toEqual(['requested']);

  // Once unblocked the same answer decides; the durable decision bytes match
  // the exact encoding the design notes pin for Java (compact UTF-8 JSON in
  // fixed key order; digest = lowercase hex SHA-256 without a prefix).
  blocked = false;
  await expect(
    resolveHostedAction(session, waiters, requestId, answer('allow')),
  ).resolves.toEqual({
    status: 200,
    body: { requestId, state: 'decided', optionId: 'allow' },
  });
  const decided = session.authority.action(requestId)!;
  expect(decided.state).toBe('decided');
  const decisionBytes = await session.resources.read(
    decided.decisionRef!.resourceId,
  );
  const expectedBytes = Buffer.from(
    '{"v":1,"optionId":"allow","inputRevision":1,"policyRevision":"hosted-tool-approval/1"}',
    'utf8',
  );
  expect(decisionBytes.equals(expectedBytes)).toBe(true);
  expect(decided.decisionRef!.digest).toBe(
    createHash('sha256').update(expectedBytes).digest('hex'),
  );
  expect(decided.decisionRef!.digest).toMatch(/^[0-9a-f]{64}$/);

  // Same decision replays as 200; a different one conflicts.
  await expect(
    resolveHostedAction(session, waiters, requestId, answer('allow')),
  ).resolves.toEqual({
    status: 200,
    body: { requestId, state: 'decided', optionId: 'allow' },
  });
  await expect(
    resolveHostedAction(session, waiters, requestId, answer('deny')),
  ).resolves.toEqual({ status: 409, code: 'action_already_resolved' });
});
