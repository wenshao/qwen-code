/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maintainer verification harness for PR #10300.
 *
 * NOT part of the repository. The identical file is dropped into the `main`
 * baseline worktree and into the PR worktree and run in both; only the
 * product code differs.
 *
 * Everything below runs against a real temporary filesystem and calls the
 * real production entry points (`archiveDaemonSessions`,
 * `unarchiveDaemonSessions`, `deleteDaemonSessions`) with a real
 * `WorkspaceGenerationGuard`, a real `SessionArchiveCoordinator` and a real
 * `SessionService`. No product module is mocked. Fault injection only
 * changes the world (closes a real guard, replaces a real lock file) at a
 * defined moment; the fences being exercised are the product's own.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService, Storage } from '@qwen-code/qwen-code-core';
import {
  archiveDaemonSessions,
  deleteDaemonSessions,
  SessionArchiveCoordinator,
  unarchiveDaemonSessions,
} from './session-archive.js';
import { createWorkspaceGenerationGuard } from '../workspace-registry.js';

const SESSION_ID = '550e8400-e29b-41d4-a716-4466554400aa';
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

function transcriptPath(state: 'active' | 'archived'): string {
  return path.join(chatsDir(state), `${SESSION_ID}.jsonl`);
}

function sidecarPaths(state: 'active' | 'archived') {
  const dir = chatsDir(state);
  return {
    worktree: path.join(dir, `${SESSION_ID}.worktree.json`),
    pr: path.join(dir, `${SESSION_ID}.pr.json`),
    ledger: path.join(dir, `${SESSION_ID}.ledger.jsonl`),
  };
}

function fileHistoryDir(): string {
  return path.join(qwenHome, 'file-history', SESSION_ID);
}

function lockPath(): string {
  return path.join(
    runtimeDir,
    'tmp',
    'session-writer-locks',
    `${encodeURIComponent(SESSION_ID)}.lock`,
  );
}

function writeTranscript(state: 'active' | 'archived'): void {
  fs.mkdirSync(chatsDir(state), { recursive: true });
  fs.writeFileSync(
    transcriptPath(state),
    `${JSON.stringify({
      uuid: 'record-1',
      parentUuid: null,
      sessionId: SESSION_ID,
      timestamp: '2024-01-01T00:00:00.000Z',
      type: 'user',
      message: { role: 'user', parts: [{ text: 'hello' }] },
      cwd: workspaceDir,
      version: '1.0.0',
    })}\n`,
  );
}

function writeSidecars(state: 'active' | 'archived'): void {
  fs.mkdirSync(chatsDir(state), { recursive: true });
  const p = sidecarPaths(state);
  fs.writeFileSync(
    p.worktree,
    JSON.stringify({ sessionId: SESSION_ID, worktreePath: '/tmp/wt' }),
  );
  fs.writeFileSync(
    p.pr,
    JSON.stringify({
      version: 1,
      prs: [
        {
          platform: 'github',
          owner: 'o',
          repo: 'r',
          number: 1,
          url: 'https://example.invalid/pr/1',
        },
      ],
    }),
  );
  fs.writeFileSync(p.ledger, `${JSON.stringify({ kind: 'prompt' })}\n`);
}

function writeFileHistory(): void {
  fs.mkdirSync(fileHistoryDir(), { recursive: true });
  fs.writeFileSync(path.join(fileHistoryDir(), 'backup.txt'), 'backup');
}

function snapshot(state: 'active' | 'archived') {
  const p = sidecarPaths(state);
  return {
    transcript: fs.existsSync(transcriptPath(state)),
    worktree: fs.existsSync(p.worktree),
    pr: fs.existsSync(p.pr),
    ledger: fs.existsSync(p.ledger),
  };
}

const NOTHING = {
  transcript: false,
  worktree: false,
  pr: false,
  ledger: false,
};
const EVERYTHING = {
  transcript: true,
  worktree: true,
  pr: true,
  ledger: true,
};

function record(scenario: string, data: Record<string, unknown>): void {
  OBSERVATIONS.push({ scenario, ...data });
}

/**
 * Real generation guard that closes the moment the primary transcript
 * mutation is observed to have committed on the real filesystem. Models the
 * race the PR describes: "a daemon runtime generation may close immediately
 * after the transcript has already been unlinked, moved, or chosen as the
 * losing conflict copy". The trigger is real filesystem state.
 */
function guardClosingAfterPrimaryMutation(watched: string) {
  const guard = createWorkspaceGenerationGuard();
  const assertCanMutate = () => {
    if (!guard.closed && !fs.existsSync(watched)) guard.close();
    guard.assertOpen();
  };
  return { guard, assertCanMutate };
}

/**
 * Replaces the writer lock with a byte-for-byte identical copy at a new
 * inode, once, at the first post-commit ownership check. Models a lease that
 * was silently replaced by another owner. Contents stay equal, so only an
 * inode-level identity check can notice.
 */
function makeLockSwapper(watched: string) {
  let swapped = false;
  const inject = () => {
    if (swapped) return;
    if (fs.existsSync(watched)) return; // primary mutation not committed yet
    if (!fs.existsSync(lockPath())) return;
    swapped = true;
    const raw = fs.readFileSync(lockPath());
    const temp = `${lockPath()}.impostor`;
    fs.writeFileSync(temp, raw);
    fs.renameSync(temp, lockPath());
  };
  return { inject, didSwap: () => swapped };
}

const LIFECYCLE_METHODS = new Set([
  'archiveSessions',
  'unarchiveSessions',
  'removeSession',
  'cleanupRemovedSessionState',
  'cleanupRemovedSessionStateForLifecycle',
]);

/**
 * Runs `inject` immediately before the product's own post-commit ownership
 * fence. On the PR that fence is `assertCleanupOwned` (the writer lease); on
 * `main` the only post-commit fence is `assertCanMutate` (the runtime
 * generation). Both are decorated so the injection point is the same moment
 * in both trees. The fences themselves are untouched.
 */
function withPostCommitInjection(
  base: SessionService,
  inject: () => void,
): SessionService {
  const wrapOptions = (options: unknown): unknown => {
    if (!options || typeof options !== 'object') return options;
    const source = options as Record<string, unknown>;
    const out: Record<string, unknown> = { ...source };
    for (const key of ['assertCleanupOwned', 'assertCanMutate']) {
      const fn = source[key];
      if (typeof fn === 'function') {
        out[key] = () => {
          inject();
          (fn as () => void)();
        };
      }
    }
    return out;
  };
  return new Proxy(base, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (!LIFECYCLE_METHODS.has(String(prop))) return fn.bind(target);
      return (...args: unknown[]) => {
        if (args.length >= 2) args[args.length - 1] = wrapOptions(args.at(-1));
        return fn.apply(target, args);
      };
    },
  }) as SessionService;
}

const bridge = {
  closeSession: async () => {},
  deleteSessionAttachments: async () => {},
} as never;

function service(): SessionService {
  return new SessionService(workspaceDir, { runtimeBaseDir: runtimeDir });
}

function summarize(result: {
  errors: Array<{ sessionId: string; error: unknown }>;
}): string[] {
  return result.errors.map((entry) =>
    entry.error instanceof Error
      ? `${entry.error.name}: ${entry.error.message}`
      : String(entry.error),
  );
}

beforeEach(() => {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr10300-runtime-'));
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr10300-workspace-'));
  qwenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pr10300-home-'));
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

describe('A. runtime generation closes right after the primary mutation', () => {
  it('S1 archive keeps the sidecars with the transcript', async () => {
    writeTranscript('active');
    writeSidecars('active');
    const { assertCanMutate, guard } = guardClosingAfterPrimaryMutation(
      transcriptPath('active'),
    );

    const result = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate,
    });

    record('S1 archive under generation close', {
      generationClosed: guard.closed,
      archived: result.archived,
      alreadyArchived: result.alreadyArchived,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(guard.closed).toBe(true);
    expect(result.archived).toEqual([SESSION_ID]);
    expect(snapshot('active')).toEqual(NOTHING);
    expect(snapshot('archived')).toEqual(EVERYTHING);
  });

  it('S2 unarchive keeps the sidecars with the transcript', async () => {
    writeTranscript('archived');
    writeSidecars('archived');
    const { assertCanMutate, guard } = guardClosingAfterPrimaryMutation(
      transcriptPath('archived'),
    );

    const result = await unarchiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate,
    });

    record('S2 unarchive under generation close', {
      generationClosed: guard.closed,
      unarchived: result.unarchived,
      alreadyActive: result.alreadyActive,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(guard.closed).toBe(true);
    expect(result.unarchived).toEqual([SESSION_ID]);
    expect(snapshot('archived')).toEqual(NOTHING);
    expect(snapshot('active')).toEqual(EVERYTHING);
  });

  it('S3 delete removes the sidecars and the file-history backups', async () => {
    writeTranscript('active');
    writeSidecars('active');
    writeFileHistory();
    const { assertCanMutate, guard } = guardClosingAfterPrimaryMutation(
      transcriptPath('active'),
    );

    const result = await deleteDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate,
    });

    record('S3 delete under generation close', {
      generationClosed: guard.closed,
      deleted: (result as { deleted?: string[] }).deleted,
      errors: (result as { errors?: unknown[] }).errors?.length ?? 0,
      active: snapshot('active'),
      fileHistory: fs.existsSync(fileHistoryDir()),
    });

    expect(guard.closed).toBe(true);
    expect(snapshot('active')).toEqual(NOTHING);
    expect(fs.existsSync(fileHistoryDir())).toBe(false);
  });

  it('S4 archive conflict repair drops the losing copy and its sidecars', async () => {
    writeTranscript('active');
    writeTranscript('archived');
    writeSidecars('active');
    writeSidecars('archived');
    const { assertCanMutate, guard } = guardClosingAfterPrimaryMutation(
      transcriptPath('active'),
    );

    const result = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      resolveConflicts: true,
      assertCanMutate,
    });

    record('S4 archive conflict repair under generation close', {
      generationClosed: guard.closed,
      archived: result.archived,
      resolvedConflicts: result.resolvedConflicts,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(guard.closed).toBe(true);
    expect(snapshot('active')).toEqual(NOTHING);
    expect(snapshot('archived').transcript).toBe(true);
  });

  it('S5 unarchive conflict repair drops the losing copy and its sidecars', async () => {
    writeTranscript('active');
    writeTranscript('archived');
    writeSidecars('active');
    writeSidecars('archived');
    const { assertCanMutate, guard } = guardClosingAfterPrimaryMutation(
      transcriptPath('archived'),
    );

    const result = await unarchiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      coordinator: new SessionArchiveCoordinator(),
      resolveConflicts: true,
      assertCanMutate,
    });

    record('S5 unarchive conflict repair under generation close', {
      generationClosed: guard.closed,
      unarchived: result.unarchived,
      resolvedConflicts: result.resolvedConflicts,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(guard.closed).toBe(true);
    expect(snapshot('archived')).toEqual(NOTHING);
    expect(snapshot('active').transcript).toBe(true);
  });
});

describe('B. a plain retry resumes an interrupted cleanup', () => {
  it('S6 archive retry over stranded sidecars finishes the move', async () => {
    // Exactly the state the bug leaves behind: transcript already archived,
    // sidecars stranded in active/. The guard is open; this is a plain retry.
    writeTranscript('archived');
    writeSidecars('active');

    const result = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });

    record('S6 archive retry over residue', {
      alreadyArchived: result.alreadyArchived,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(result.alreadyArchived).toEqual([SESSION_ID]);
    expect(snapshot('active')).toEqual(NOTHING);
    expect(snapshot('archived')).toEqual(EVERYTHING);
  });

  it('S7 unarchive retry over stranded sidecars finishes the move', async () => {
    writeTranscript('active');
    writeSidecars('archived');

    const result = await unarchiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });

    record('S7 unarchive retry over residue', {
      alreadyActive: result.alreadyActive,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(result.alreadyActive).toEqual([SESSION_ID]);
    expect(snapshot('archived')).toEqual(NOTHING);
    expect(snapshot('active')).toEqual(EVERYTHING);
  });
});

describe('C. ownership fence after the primary mutation', () => {
  it('S8 archive stops when the writer lock is swapped for an identical file', async () => {
    writeTranscript('active');
    writeSidecars('active');
    const swapper = makeLockSwapper(transcriptPath('active'));

    const result = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: withPostCommitInjection(service(), swapper.inject),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });

    record('S8 archive with a stolen writer lock', {
      lockSwapped: swapper.didSwap(),
      archived: result.archived,
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(swapper.didSwap()).toBe(true);
    // The primary mutation already committed and is deliberately not rolled back.
    expect(snapshot('archived').transcript).toBe(true);
    // Auxiliary cleanup must have refused to run under an unproven lease.
    expect(snapshot('active').worktree).toBe(true);
    expect(snapshot('active').pr).toBe(true);
    expect(snapshot('active').ledger).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('S9 delete stops when the writer lock is swapped for an identical file', async () => {
    writeTranscript('active');
    writeSidecars('active');
    writeFileHistory();
    const swapper = makeLockSwapper(transcriptPath('active'));

    const result = await deleteDaemonSessions({
      sessionIds: [SESSION_ID],
      service: withPostCommitInjection(service(), swapper.inject),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
      assertCanMutate: () => {},
    });

    record('S9 delete with a stolen writer lock', {
      lockSwapped: swapper.didSwap(),
      errors: (result as { errors?: unknown[] }).errors?.length ?? 0,
      active: snapshot('active'),
      fileHistory: fs.existsSync(fileHistoryDir()),
    });

    expect(swapper.didSwap()).toBe(true);
    expect(fs.existsSync(transcriptPath('active'))).toBe(false);
    expect(snapshot('active').worktree).toBe(true);
    expect(fs.existsSync(fileHistoryDir())).toBe(true);
  });
});

describe('D. ordinary behaviour is unchanged', () => {
  it('S10 plain archive then unarchive round-trips transcript and sidecars', async () => {
    writeTranscript('active');
    writeSidecars('active');

    const a = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
    });
    const afterArchive = snapshot('archived');

    const u = await unarchiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      coordinator: new SessionArchiveCoordinator(),
    });

    record('S10 plain archive/unarchive round trip', {
      archived: a.archived,
      unarchived: u.unarchived,
      afterArchive,
      afterUnarchive: snapshot('active'),
    });

    expect(a.archived).toEqual([SESSION_ID]);
    expect(afterArchive).toEqual(EVERYTHING);
    expect(u.unarchived).toEqual([SESSION_ID]);
    expect(snapshot('active')).toEqual(EVERYTHING);
  });

  it('S11 archive of an unknown id still reports notFound', async () => {
    const result = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
    });
    record('S11 archive of an unknown id', {
      notFound: result.notFound,
      errors: summarize(result),
    });
    expect(result.notFound).toEqual([SESSION_ID]);
    expect(result.errors).toEqual([]);
  });

  it('S12 conflict without resolveConflicts still moves nothing', async () => {
    writeTranscript('active');
    writeTranscript('archived');

    const result = await archiveDaemonSessions({
      sessionIds: [SESSION_ID],
      service: service(),
      bridge,
      coordinator: new SessionArchiveCoordinator(),
    });

    record('S12 unresolved conflict', {
      errors: summarize(result),
      active: snapshot('active'),
      archivedDir: snapshot('archived'),
    });

    expect(result.errors.length).toBe(1);
    expect(snapshot('active').transcript).toBe(true);
    expect(snapshot('archived').transcript).toBe(true);
  });
});
