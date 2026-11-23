// ---------------------------------------------------------------------------
// VERIFY-18177 A/B driver block. This block is byte-identical in both arms and
// exercises only the arm's production `sendPrompt`. Arm selection comes from
// VERIFY_ARM so each side asserts its own contract without guessing.
// ---------------------------------------------------------------------------
import { appendFileSync } from 'node:fs';

const VERIFY_ARM = process.env['VERIFY_ARM'] as 'base' | 'head' | undefined;
function vlog(line: string): void {
  const target = process.env['VERIFY_LOG'];
  if (target) appendFileSync(target, line + '\n');
}

describe('VERIFY-18177 admission retry A/B', () => {
  const connection = () =>
    ({
      status: 'connected',
      workspaceCwd: '/workspace',
      capabilities: {
        v: 1,
        mode: 'http-bridge',
        features: ['session_attachments'],
        modelServices: [],
      },
    }) as never;

  function settleOnAdmit(activePromptsRef: {
    current: Map<string, ActivePrompt>;
  }) {
    return () => {
      queueMicrotask(() => {
        activePromptsRef.current
          .get('session-a')
          ?.resolve?.({ stopReason: 'end_turn' } as never);
      });
    };
  }

  it('transient TypeError+503: attempt count, key reuse and backoff gaps', async () => {
    vi.useFakeTimers();
    try {
      const session = createMockSession('session-a');
      const key = 'verify-key-1';
      const calls: Array<{ at: number; key: unknown }> = [];
      const start = Date.now();
      session.submitPrompt.mockImplementation((async (req: {
        idempotencyKey?: string;
      }) => {
        calls.push({ at: Date.now() - start, key: req?.idempotencyKey });
        if (calls.length === 1) throw new TypeError('Failed to fetch');
        if (calls.length === 2)
          throw new DaemonHttpError(503, undefined, 'gateway unavailable');
        return { promptId: 'prompt-ok', lastEventId: 1 };
      }) as never);
      const { actions, activePromptsRef } = createActionsHarness({
        session,
        connection: connection(),
      });
      const pending = actions
        .sendPrompt('look', {
          idempotencyKey: key,
          images: [{ data: 'AQID', mimeType: 'image/png' }],
          onAdmitted: settleOnAdmit(activePromptsRef),
        } as never)
        .catch((error: unknown) => ({ rejected: error }));

      await vi.waitFor(() =>
        expect(session.submitPrompt.mock.calls.length).toBeGreaterThanOrEqual(1),
      );
      // Arm-neutral drive: the retry schedule (if any) is 400 ms then 1200 ms.
      // Advancing both windows must settle every arm's promise; an arm without
      // retries simply has nothing scheduled.
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(1200);
      const outcome = await pending;

      vlog(
        `ROW retry-3-attempts arm=${VERIFY_ARM} calls=${calls.length} ` +
          `gaps=${JSON.stringify(calls.map((c) => c.at))} ` +
          `keys=${JSON.stringify(calls.map((c) => c.key))} ` +
          `outcome=${'rejected' in outcome ? 'rejected' : 'resolved'}`,
      );
      if (VERIFY_ARM === 'head') {
        expect(calls.length).toBe(3);
        // Relative gaps are the contract; the absolute origin is the fake
        // clock's start, which includes the test's own setup ticks.
        expect([calls[1].at - calls[0].at, calls[2].at - calls[1].at]).toEqual([
          400, 1200,
        ]);
        expect(calls.map((c) => c.key)).toEqual([key, key, key]);
        expect('rejected' in outcome).toBe(false);
        expect(session.uploadAttachment).toHaveBeenCalledTimes(1);
        expect(session.removeAttachment).not.toHaveBeenCalled();
      } else {
        expect(calls.length).toBe(1);
        expect(calls.map((c) => c.key)).toEqual([undefined]);
        expect('rejected' in outcome).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('definite 413: single attempt and attachment cleanup on both arms', async () => {
    vi.useFakeTimers();
    try {
      const session = createMockSession('session-a');
      session.submitPrompt.mockRejectedValueOnce(
        new DaemonHttpError(413, undefined, 'too large'),
      );
      const { actions } = createActionsHarness({
        session,
        connection: connection(),
      });
      const outcome = await actions
        .sendPrompt('look', {
          idempotencyKey: 'verify-key-413',
          images: [{ data: 'AQID', mimeType: 'image/png' }],
        } as never)
        .catch((error: unknown) => ({ rejected: error }));
      vlog(
        `ROW definite-413 arm=${VERIFY_ARM} calls=${
          session.submitPrompt.mock.calls.length
        } removed=${session.removeAttachment.mock.calls.length}`,
      );
      expect('rejected' in outcome).toBe(true);
      expect(session.submitPrompt).toHaveBeenCalledTimes(1);
      expect(session.removeAttachment).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exhausted transient failures: attempt count, cleanup, optimistic block', async () => {
    vi.useFakeTimers();
    try {
      const session = createMockSession('session-a');
      session.submitPrompt.mockRejectedValue(new TypeError('Failed to fetch'));
      const { actions, store } = createActionsHarness({
        session,
        connection: connection(),
      });
      const pending = actions
        .sendPrompt('look', {
          idempotencyKey: 'verify-key-exhaust',
          images: [{ data: 'AQID', mimeType: 'image/png' }],
        } as never)
        .catch((error: unknown) => error);
      await vi.waitFor(() =>
        expect(session.submitPrompt.mock.calls.length).toBeGreaterThanOrEqual(1),
      );
      // Arm-neutral drive: the retry schedule (if any) is 400 ms then 1200 ms.
      // Advancing both windows must settle every arm's promise; an arm without
      // retries simply has nothing scheduled.
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(1200);
      const error = await pending;
      vlog(
        `ROW exhausted arm=${VERIFY_ARM} calls=${
          session.submitPrompt.mock.calls.length
        } removed=${session.removeAttachment.mock.calls.length} ` +
          `optimistic=${store.appendLocalUserMessage.mock.calls.length} ` +
          `message=${String((error as Error)?.message)}`,
      );
      if (VERIFY_ARM === 'head') {
        expect(session.submitPrompt).toHaveBeenCalledTimes(3);
      } else {
        expect(session.submitPrompt).toHaveBeenCalledTimes(1);
      }
      expect(session.removeAttachment).not.toHaveBeenCalled();
      expect(store.appendLocalUserMessage).toHaveBeenCalledTimes(1);
      expect(String((error as Error)?.message)).toBe('Failed to fetch');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a 503 on the first attempt: base treats it as definite, head retries', async () => {
    vi.useFakeTimers();
    try {
      const session = createMockSession('session-a');
      session.submitPrompt
        .mockRejectedValueOnce(new DaemonHttpError(503, undefined, 'gateway'))
        .mockResolvedValueOnce({ promptId: 'prompt-after-503' });
      const { actions, activePromptsRef } = createActionsHarness({
        session,
        connection: connection(),
      });
      const pending = actions
        .sendPrompt('look', {
          idempotencyKey: 'verify-key-503',
          images: [{ data: 'AQID', mimeType: 'image/png' }],
          onAdmitted: settleOnAdmit(activePromptsRef),
        } as never)
        .catch((error: unknown) => ({ rejected: error }));
      await vi.waitFor(() =>
        expect(session.submitPrompt.mock.calls.length).toBeGreaterThanOrEqual(1),
      );
      await vi.advanceTimersByTimeAsync(400);
      await pending;
      vlog(
        `ROW 503-first arm=${VERIFY_ARM} calls=${
          session.submitPrompt.mock.calls.length
        } removed=${session.removeAttachment.mock.calls.length}`,
      );
      if (VERIFY_ARM === 'head') {
        expect(session.submitPrompt).toHaveBeenCalledTimes(2);
        expect(session.removeAttachment).not.toHaveBeenCalled();
      } else {
        expect(session.submitPrompt).toHaveBeenCalledTimes(1);
        expect(session.removeAttachment).toHaveBeenCalledTimes(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('beforeDispatch is revalidated on every attempt', async () => {
    vi.useFakeTimers();
    try {
      const session = createMockSession('session-a');
      let attempts = 0;
      session.submitPrompt.mockImplementation((async (
        _req: unknown,
        _signal?: AbortSignal,
        beforeDispatch?: () => void,
      ) => {
        beforeDispatch?.();
        attempts += 1;
        if (attempts <= 2) throw new TypeError('Failed to fetch');
        return { promptId: 'prompt-ok' };
      }) as never);
      const { actions, activePromptsRef } = createActionsHarness({
        session,
        connection: connection(),
      });
      let vetos = 0;
      const pending = actions
        .sendPrompt('look', {
          idempotencyKey: 'verify-key-veto',
          beforeDispatch: () => {
            vetos += 1;
          },
          onAdmitted: settleOnAdmit(activePromptsRef),
        } as never)
        .catch((error: unknown) => error);
      await vi.waitFor(() =>
        expect(session.submitPrompt.mock.calls.length).toBeGreaterThanOrEqual(1),
      );
      // Arm-neutral drive: the retry schedule (if any) is 400 ms then 1200 ms.
      // Advancing both windows must settle every arm's promise; an arm without
      // retries simply has nothing scheduled.
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(1200);
      await pending;
      vlog(
        `ROW before-dispatch arm=${VERIFY_ARM} vetos=${vetos} calls=${session.submitPrompt.mock.calls.length}`,
      );
      if (VERIFY_ARM === 'head') {
        expect(vetos).toBe(3);
      } else {
        expect(vetos).toBe(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('a lost 202 after real admission: the daemon ring collapses retries', async () => {
    vi.useFakeTimers();
    try {
      const session = createMockSession('session-a');
      // Models the dedupe contract measured on the real daemon by
      // wire-dedup-probe.mjs: a repeated key returns the first promptId with
      // deduplicated:true and does not enqueue a second turn. The first POST
      // is accepted, then its response is lost, so the client sees a
      // transport error while the server already queued turn #1.
      let serverTurns = 0;
      const admitted = new Map<string, string>();
      session.submitPrompt.mockImplementation((async (req: {
        idempotencyKey?: string;
      }) => {
        const key = req?.idempotencyKey;
        if (key !== undefined && admitted.has(key)) {
          return { promptId: admitted.get(key), deduplicated: true };
        }
        serverTurns += 1;
        const promptId = `prompt-${serverTurns}`;
        if (key !== undefined) admitted.set(key, promptId);
        if (serverTurns === 1) throw new TypeError('Failed to fetch');
        return { promptId };
      }) as never);
      const { actions, activePromptsRef } = createActionsHarness({
        session,
        connection: connection(),
      });
      const pending = actions
        .sendPrompt('deploy the fix', {
          idempotencyKey: 'verify-key-lost-202',
          onAdmitted: settleOnAdmit(activePromptsRef),
        } as never)
        .catch((error: unknown) => ({ rejected: error }));
      await vi.waitFor(() =>
        expect(session.submitPrompt.mock.calls.length).toBeGreaterThanOrEqual(1),
      );
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(1200);
      const outcome = await pending;
      vlog(
        `ROW lost-202-turns arm=${VERIFY_ARM} clientAttempts=${session.submitPrompt.mock.calls.length} serverTurns=${serverTurns} outcome=${'rejected' in outcome ? 'rejected' : 'resolved'}`,
      );
      expect(serverTurns).toBe(1);
      if (VERIFY_ARM === 'head') {
        // The 400 ms retry is the one the ring collapses, so only two client
        // attempts are made: attempt 1 lost its 202, attempt 2 deduplicated.
        expect(session.submitPrompt.mock.calls.length).toBe(2);
        expect('rejected' in outcome).toBe(false);
      } else {
        expect(session.submitPrompt.mock.calls.length).toBe(1);
        expect('rejected' in outcome).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});