// @vitest-environment jsdom
/**
 * PR 18102 verify probe — the 50 ms batching floor must not delay terminal
 * frames, and must defer non-terminal trickle. The PR's own hook suite awaits a
 * 60 ms helper before every assertion, so neither timing is pinned there.
 *
 * Margins are measured, not sampled: the throttle window is 50 ms, so a 20 ms
 * observation point leaves 30 ms of slack on the "deferred" side and 30 ms on
 * the "flushed" side.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  DaemonArtifactLibrarySessionEnvelope,
  DaemonSessionArtifact,
  DaemonWorkspaceArtifactLibraryStreamEvent,
} from '@qwen-code/sdk/daemon';
import {
  useWorkspaceArtifactLibrary,
  WORKSPACE_ARTIFACT_LIBRARY_FEATURE,
  WORKSPACE_ARTIFACT_LIBRARY_STREAM_FEATURE,
  type WorkspaceArtifactLibraryReader,
} from './useWorkspaceArtifactLibrary';

const ARM = process.env['VERIFY_ARM'] === 'base' ? 'base' : 'head';
const OBSERVE_MS = 20;

function makeArtifact(id: string): DaemonSessionArtifact {
  return {
    id,
    title: `${id}.md`,
    kind: 'document',
    storage: 'workspace',
    workspacePath: `docs/${id}.md`,
    status: 'available',
    source: 'tool',
    retention: 'restorable',
    clientRetained: false,
    createdAt: '2026-11-21T08:00:00.000Z',
    updatedAt: '2026-11-21T09:00:00.000Z',
  };
}

function makeEnvelope(
  sessionId: string,
  artifacts: DaemonSessionArtifact[],
): DaemonArtifactLibrarySessionEnvelope {
  return {
    v: 1,
    sessionId,
    generatedAt: '2026-11-21T10:00:00.000Z',
    limits: { maxArtifacts: 100 },
    session: {
      createdAt: '2026-11-20T00:00:00.000Z',
      archiveState: 'active',
      sourceType: 'web',
    },
    artifacts,
  };
}

function createControlledStream() {
  const queue: DaemonWorkspaceArtifactLibraryStreamEvent[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  const push = (event: DaemonWorkspaceArtifactLibraryStreamEvent) => {
    queue.push(event);
    const fn = notify;
    notify = undefined;
    fn?.();
  };
  async function* iterable(): AsyncGenerator<DaemonWorkspaceArtifactLibraryStreamEvent> {
    while (true) {
      while (queue.length > 0) yield queue.shift()!;
      if (closed) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }
  return { push, close: () => (closed = true), iterable };
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function setup() {
  const stream = createControlledStream();
  const reader: WorkspaceArtifactLibraryReader = {
    artifactLibrary: async () => ({ sessions: [], errors: [] }),
    artifactLibraryStream: () => stream.iterable(),
  } as WorkspaceArtifactLibraryReader;
  const rendered = renderHook(() =>
    useWorkspaceArtifactLibrary({
      workspaceSelector: '/work/a',
      reader,
      features: [
        WORKSPACE_ARTIFACT_LIBRARY_FEATURE,
        WORKSPACE_ARTIFACT_LIBRARY_STREAM_FEATURE,
      ],
    }),
  );
  return { stream, result: rendered.result };
}

describe(`trickle batching timing (arm=${ARM})`, () => {
  it(`first paint is not delayed by the floor (observed at ${OBSERVE_MS} ms)`, async () => {
    const { stream, result } = setup();
    stream.push({ type: 'start', v: 1, total: 2 });
    stream.push({ type: 'session', ...makeEnvelope('s1', [makeArtifact('a1')]) });
    await wait(OBSERVE_MS);
    console.log(`CELL first-paint rows=${result.current.rows.length}`);
    expect(result.current.rows).toHaveLength(1);
  });

  it('terminal complete flushes well inside the 50 ms floor (both arms)', async () => {
    const { stream, result } = setup();
    stream.push({ type: 'start', v: 1, total: 2 });
    stream.push({ type: 'session', ...makeEnvelope('s1', [makeArtifact('a1')]) });
    await wait(OBSERVE_MS);
    expect(result.current.rows).toHaveLength(1);
    stream.push({ type: 'session', ...makeEnvelope('s2', [makeArtifact('a2')]) });
    stream.push({ type: 'complete', v: 1, total: 2, succeeded: 2, failed: 0, skipped: 0 });
    stream.close();
    await wait(OBSERVE_MS);
    console.log(
      `CELL terminal-flush rows=${result.current.rows.length} complete=${String(result.current.complete)} observeMs=${OBSERVE_MS}`,
    );
    expect(result.current.complete).toBe(true);
    expect(result.current.rows).toHaveLength(2);
  });

  it(`non-terminal trickle is deferred at ${OBSERVE_MS} ms only on head`, async () => {
    const { stream, result } = setup();
    stream.push({ type: 'start', v: 1, total: 3 });
    stream.push({ type: 'session', ...makeEnvelope('s1', [makeArtifact('a1')]) });
    await wait(OBSERVE_MS);
    expect(result.current.rows).toHaveLength(1);
    stream.push({ type: 'session', ...makeEnvelope('s2', [makeArtifact('a2')]) });
    await wait(OBSERVE_MS);
    const afterObserve = result.current.rows.length;
    await wait(60);
    const afterWindow = result.current.rows.length;
    console.log(
      `CELL trickle-window arm=${ARM} after${OBSERVE_MS}ms=${afterObserve} afterWindow=${afterWindow}`,
    );
    expect(afterObserve).toBe(ARM === 'head' ? 1 : 2);
    expect(afterWindow).toBe(2);
  });
});
