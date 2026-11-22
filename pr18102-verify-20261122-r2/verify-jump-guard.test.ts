/**
 * PR 18102 verify harness — the post-unarchive `isCurrent()` staleness guard.
 *
 * Calls the real `runArtifactLibrarySessionJump` with deferred promises, so the
 * mid-unarchive navigation race is driven deterministically. ARM=base is the
 * control: the pre-PR function has no `isCurrent` hook and therefore overwrites
 * the user's navigation.
 */
import { describe, expect, it, vi } from 'vitest';
import { runArtifactLibrarySessionJump } from './artifactUtils.js';

const ARM = process.env['VERIFY_ARM'] === 'base' ? 'base' : 'head';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-a',
    archiveState: 'archived',
    artifactId: 'art-a',
    targetCwd: '/work/p',
    primaryCwd: '/work/p',
    showChat: vi.fn(),
    unarchivePrimarySession: vi.fn(async () => {}),
    unarchiveWorkspaceSessions: vi.fn(),
    getPendingJumpArtifactOpen: () => undefined,
    setPendingJumpArtifactOpen: vi.fn(),
    loadSidebarSession: vi.fn(async () => {}),
    reportError: vi.fn(),
    ...overrides,
  } as never;
}

describe(`artifact library jump guard (arm=${ARM})`, () => {
  it('happy path: a current jump arms the open and loads the session (both arms)', async () => {
    const d = deps({ isCurrent: () => true });
    await runArtifactLibrarySessionJump(d);
    expect(d.setPendingJumpArtifactOpen).toHaveBeenCalledWith({
      sessionId: 'sess-a',
      artifactId: 'art-a',
    });
    expect(d.loadSidebarSession).toHaveBeenCalledTimes(1);
    expect(d.loadSidebarSession).toHaveBeenCalledWith('sess-a', '/work/p');
    expect(d.reportError).not.toHaveBeenCalled();
  });

  it('active session: pending open is armed and loaded without unarchive (both arms)', async () => {
    const d = deps({
      archiveState: 'active',
      isCurrent: () => true,
    });
    await runArtifactLibrarySessionJump(d);
    expect(d.setPendingJumpArtifactOpen).toHaveBeenCalledWith({
      sessionId: 'sess-a',
      artifactId: 'art-a',
    });
    expect(d.unarchivePrimarySession).not.toHaveBeenCalled();
    expect(d.loadSidebarSession).toHaveBeenCalledTimes(1);
  });

  it('mid-unarchive navigation must cancel the jump (head) / is overwritten (base)', async () => {
    const gate = deferred<void>();
    let current = true;
    const d = deps({
      unarchivePrimarySession: vi.fn(() => gate.promise),
      loadSidebarSession: vi.fn(async () => {}),
      isCurrent: () => current,
    });
    const jump = runArtifactLibrarySessionJump(d);
    // The user clicks another session while the unarchive RPC is in flight.
    current = false;
    gate.resolve();
    await jump;
    const expectedLoads = ARM === 'head' ? 0 : 1;
    const expectedArmed = ARM === 'head' ? 0 : 1;
    console.log(
      `CELL mid-unarchive-navigation loads=${d.loadSidebarSession.mock.calls.length} armed=${d.setPendingJumpArtifactOpen.mock.calls.filter(([r]) => r !== undefined).length}`,
    );
    expect(d.loadSidebarSession).toHaveBeenCalledTimes(expectedLoads);
    expect(
      d.setPendingJumpArtifactOpen.mock.calls.filter(([r]) => r !== undefined),
    ).toHaveLength(expectedArmed);
    expect(d.reportError).not.toHaveBeenCalled();
  });

  it('unarchive rejection after navigation stays silent (head) / toasts (base)', async () => {
    const gate = deferred<void>();
    let current = true;
    const d = deps({
      unarchivePrimarySession: vi.fn(() => gate.promise),
      isCurrent: () => current,
    });
    const jump = runArtifactLibrarySessionJump(d);
    current = false;
    gate.reject(new Error('unarchive failed after abandon'));
    await jump;
    const expectedReports = ARM === 'head' ? 0 : 1;
    console.log(
      `CELL stale-unarchive-error reports=${d.reportError.mock.calls.length}`,
    );
    expect(d.reportError).toHaveBeenCalledTimes(expectedReports);
    expect(d.loadSidebarSession).not.toHaveBeenCalled();
  });

  it('own load rejection while current clears pending and reports (both arms)', async () => {
    let pending: { sessionId: string; artifactId: string } | undefined;
    const d = deps({
      isCurrent: () => true,
      getPendingJumpArtifactOpen: () => pending,
      setPendingJumpArtifactOpen: vi.fn(
        (request: { sessionId: string; artifactId: string } | undefined) => {
          pending = request;
        },
      ),
      loadSidebarSession: vi
        .fn()
        .mockRejectedValue(new Error('session deleted concurrently')),
    });
    await runArtifactLibrarySessionJump(d);
    expect(d.setPendingJumpArtifactOpen).toHaveBeenLastCalledWith(undefined);
    expect(d.reportError).toHaveBeenCalledTimes(1);
    expect(d.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'session deleted concurrently' }),
      'Failed to open session',
    );
  });

  it('cross-workspace unarchive errors[] throw before arming (both arms)', async () => {
    const d = deps({
      targetCwd: '/work/secondary',
      primaryCwd: '/work/primary',
      unarchiveWorkspaceSessions: vi.fn(async () => ({
        unarchived: [],
        alreadyActive: [],
        notFound: [],
        errors: [{ sessionId: 'sess-a', error: 'session_archiving' }],
      })),
      isCurrent: () => true,
    });
    await runArtifactLibrarySessionJump(d);
    expect(d.loadSidebarSession).not.toHaveBeenCalled();
    expect(d.setPendingJumpArtifactOpen).not.toHaveBeenCalled();
    expect(d.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'session_archiving' }),
      'Failed to open session',
    );
  });
});
