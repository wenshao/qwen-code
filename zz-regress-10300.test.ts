/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PR #10300 regression probes (maintainer verification, not part of the repo).
 *
 * PR #10300 deletes the early `alreadyArchived` / `alreadyActive` return in
 * `archiveDaemonSessions` / `unarchiveDaemonSessions`, so those no-op cases
 * now go through writer-lease acquisition in order to resume pending sidecar
 * cleanup. These probes measure what that costs.
 *
 * The file is identical in the `main` baseline worktree and the PR worktree;
 * it records observations rather than asserting a single expected tree, so
 * both runs produce a comparable report.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SessionService,
  Storage,
  type SessionWriterLease,
} from '@qwen-code/qwen-code-core';
import {
  archiveDaemonSessions,
  SessionArchiveCoordinator,
  unarchiveDaemonSessions,
} from './session-archive.js';

const OBSERVATIONS: Array<Record<string, unknown>> = [];

let runtimeDir: string;
let workspaceDir: string;
let qwenHome: string;
let previousQwenHome: string | undefined;

function chatsDir(state: 'active' | 'archived'): string {
  const base = path.join(
    new Storage(workspaceDir, runtimeDir).getProjectDir(),
    'chats',
  );
  return state === 'archived' ? path.join(base, 'archive') : base;
}

function transcriptPath(id: string, state: 'active' | 'archived'): string {
  return path.join(chatsDir(state), `${id}.jsonl`);
}

function writeTranscript(id: string, state: 'active' | 'archived'): void {
  fs.mkdirSync(chatsDir(state), { recursive: true });
  fs.writeFileSync(
    transcriptPath(id, state),
    `${JSON.stringify({
      uuid: 'record-1',
      parentUuid: null,
      sessionId: id,
      timestamp: '2024-01-01T00:00:00.000Z',
      type: 'user',
      message: { role: 'user', parts: [{ text: 'hello' }] },
      cwd: workspaceDir,
      version: '1.0.0',
    })}\n`,
  );
}

const bridge = {
  closeSession: async () => {},
  deleteSessionAttachments: async () => {},
} as never;

function service(): SessionService {
  return new SessionService(workspaceDir, { runtimeBaseDir: runtimeDir });
}

function summarize(errors: Array<{ sessionId: string; error: unknown }>) {
  return errors.map((entry) =>
    entry.error instanceof Error
      ? `${entry.error.name}: ${entry.error.message}`
      : String(entry.error),
  );
}

function record(scenario: string, data: Record<string, unknown>): void {
  OBSERVATIONS.push({ scenario, ...data });
}

function id(n: number): string {
  return `550e8400-e29b-41d4-a716-4466554${String(n).padStart(5, '0')}`;
}

beforeEach(() => {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr10300r-runtime-'));
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr10300r-workspace-'));
  qwenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pr10300r-home-'));
  previousQwenHome = process.env['QWEN_HOME'];
  process.env['QWEN_HOME'] = qwenHome;
  Storage.setRuntimeBaseDir(runtimeDir);
});

afterEach(() => {
  Storage.setRuntimeBaseDir(null);
  if (previousQwenHome === undefined) delete process.env['QWEN_HOME'];
  else process.env['QWEN_HOME'] = previousQwenHome;
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  fs.rmSync(qwenHome, { recursive: true, force: true });
});

afterAll(() => {
  const out = process.env['PR10300_OUT'];
  if (out) fs.writeFileSync(out, `${JSON.stringify(OBSERVATIONS, null, 2)}\n`);
});

describe('R. no-op lifecycle calls while a live session holds the writer lease', () => {
  it('R1 unarchive of an already-active session', async () => {
    const sessionId = id(1);
    writeTranscript(sessionId, 'active');
    // A live CLI session holding the writer lease for this transcript.
    const live: SessionWriterLease = await service().acquireSessionWriterLease(
      sessionId,
      { processKind: 'daemon', reclaimPolicy: 'never' },
    );
    try {
      const result = await unarchiveDaemonSessions({
        sessionIds: [sessionId],
        service: service(),
        coordinator: new SessionArchiveCoordinator(),
        assertCanMutate: () => {},
      });
      record('R1 unarchive already-active with live writer lease', {
        alreadyActive: result.alreadyActive,
        unarchived: result.unarchived,
        errors: summarize(result.errors),
      });
    } finally {
      await live.release().catch(() => undefined);
    }
  });

  it('R2 archive of an already-archived session', async () => {
    const sessionId = id(2);
    writeTranscript(sessionId, 'archived');
    // The lock is keyed by session id, so a live lease blocks the daemon's
    // writer *and* maintenance lease for the same id.
    const live: SessionWriterLease = await service().acquireSessionWriterLease(
      sessionId,
      { processKind: 'daemon', reclaimPolicy: 'never' },
    );
    try {
      const result = await archiveDaemonSessions({
        sessionIds: [sessionId],
        service: service(),
        bridge,
        coordinator: new SessionArchiveCoordinator(),
        assertCanMutate: () => {},
      });
      record('R2 archive already-archived with live writer lease', {
        alreadyArchived: result.alreadyArchived,
        archived: result.archived,
        errors: summarize(result.errors),
      });
    } finally {
      await live.release().catch(() => undefined);
    }
  });

  it('R3 no-op archive with no live lease still succeeds', async () => {
    const sessionId = id(3);
    writeTranscript(sessionId, 'archived');
    const result = await archiveDaemonSessions({
      sessionIds: [sessionId],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });
    record('R3 archive already-archived, no live lease', {
      alreadyArchived: result.alreadyArchived,
      errors: summarize(result.errors),
    });
    expect(result.alreadyArchived).toEqual([sessionId]);
  });
});

describe('R. cost of the removed early return', () => {
  it('R4 batch of 30 already-archived ids', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => id(100 + i));
    for (const sessionId of ids) writeTranscript(sessionId, 'archived');

    const started = Date.now();
    const result = await archiveDaemonSessions({
      sessionIds: ids,
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });
    const elapsedMs = Date.now() - started;

    const lockDir = path.join(runtimeDir, 'tmp', 'session-writer-locks');
    record('R4 batch archive of 30 already-archived ids', {
      elapsedMs,
      alreadyArchived: result.alreadyArchived.length,
      errors: summarize(result.errors).slice(0, 3),
      errorCount: result.errors.length,
      lockDirExists: fs.existsSync(lockDir),
      lockDirEntries: fs.existsSync(lockDir)
        ? fs.readdirSync(lockDir).length
        : 0,
    });
    expect(result.alreadyArchived.length).toBe(30);
  });

  it('R5 batch of 30 already-active ids (unarchive)', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => id(200 + i));
    for (const sessionId of ids) writeTranscript(sessionId, 'active');

    const started = Date.now();
    const result = await unarchiveDaemonSessions({
      sessionIds: ids,
      service: service(),
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });
    const elapsedMs = Date.now() - started;

    record('R5 batch unarchive of 30 already-active ids', {
      elapsedMs,
      alreadyActive: result.alreadyActive.length,
      errorCount: result.errors.length,
      errors: summarize(result.errors).slice(0, 3),
    });
    expect(result.alreadyActive.length).toBe(30);
  });
});
