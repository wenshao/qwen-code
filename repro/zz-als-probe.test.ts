/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// VERIFICATION PROBE (not part of the PR). Records a ledger of the
// AsyncLocalStorage session-id context observed INSIDE the non-interactive
// drain on every reachable entrance, plus the context at retry-timer
// registration. Run identically against the BASE scheduler (with the
// drain-side sessionIdContext.exit) and the HEAD scheduler (without it);
// the two ledgers must match byte-for-byte if the removal is a no-op.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sessionIdContext, type Config } from '@qwen-code/qwen-code-core';
import type { LoadedSettings } from '../../config/settings.js';

const mocks = vi.hoisted(() => ({
  cleanupOldOpenAILogs: vi.fn(),
  runThrottledOnce: vi.fn(),
}));

vi.mock('../../utils/housekeeping/cleanup.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../utils/housekeeping/cleanup.js')
    >();
  return { ...actual, cleanupOldOpenAILogs: mocks.cleanupOldOpenAILogs };
});
vi.mock('../../utils/housekeeping/throttledOnce.js', () => ({
  runThrottledOnce: mocks.runThrottledOnce,
}));

import {
  _resetNonInteractiveForTesting,
  startNonInteractiveOpenAILogHousekeeping,
  stopNonInteractiveOpenAILogHousekeeping,
} from './scheduler.js';

const LEDGER: string[] = [];
function rec(event: string) {
  LEDGER.push(`${event} ctx=${sessionIdContext.getStore() ?? '<none>'}`);
}
const OUT = process.env['ALS_PROBE_OUT']!;
function dump(tag: string) {
  fs.appendFileSync(OUT, tag + ' ' + JSON.stringify(LEDGER) + '\n');
}

function makeConfig(logDir: string, sessionId = 'hk'): Config {
  return {
    getContentGeneratorConfig: () => ({ openAILoggingDir: logDir }),
    getModelsConfig: () => ({ getGenerationConfig: () => ({}) }),
    getWorkingDir: () => process.cwd(),
    getSessionId: () => sessionId,
  } as unknown as Config;
}
function makeSettings(): LoadedSettings {
  return {
    merged: { model: { openAILogRetentionDays: 7 } },
    isTrusted: true,
    system: { settings: {} },
    systemDefaults: { settings: {} },
    user: { settings: { model: { openAILogRetentionDays: 7 } } },
    workspace: { settings: {} },
  } as unknown as LoadedSettings;
}

describe('ALS probe', () => {
  let qwenHome: string;
  let realSetTimeout: typeof setTimeout;

  beforeEach(async () => {
    await _resetNonInteractiveForTesting();
    qwenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'als-probe-'));
    vi.stubEnv('QWEN_HOME', qwenHome);
    mocks.cleanupOldOpenAILogs.mockReset();
    mocks.runThrottledOnce.mockReset();
    mocks.runThrottledOnce.mockImplementation(
      async (_o: unknown, task: () => Promise<void | false>) =>
        (await task()) === false
          ? { status: 'incomplete' }
          : { status: 'completed' },
    );
    realSetTimeout = globalThis.setTimeout;
  });

  afterEach(async () => {
    globalThis.setTimeout = realSetTimeout;
    vi.useRealTimers();
    await _resetNonInteractiveForTesting();
    vi.unstubAllEnvs();
    fs.rmSync(qwenHome, { recursive: true, force: true });
  });

  it('P1: start-side kick from inside a bound session context', async () => {
    LEDGER.length = 0;
    mocks.cleanupOldOpenAILogs.mockImplementation(async () => {
      rec('P1 drain-body');
      return { removed: 0, errors: 0, completed: true };
    });
    sessionIdContext.run('S-alpha', () => {
      startNonInteractiveOpenAILogHousekeeping(
        makeConfig(path.join(qwenHome, 'p1'), 'S-alpha'),
        makeSettings(),
      );
    });
    await vi.waitFor(() => expect(LEDGER).toHaveLength(1));
    dump('LEDGER_P1');
    expect(LEDGER[0]).toBe('P1 drain-body ctx=<none>');
  });

  it('P2: retry-timer re-entrance after a throwing job', async () => {
    LEDGER.length = 0;
    let n = 0;
    // Capture the ALS context at retry-timer REGISTRATION time.
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms === 10 * 60 * 1000) rec(`P2 timer-register(${ms})`);
      return realSetTimeout(fn, ms) as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;

    mocks.cleanupOldOpenAILogs.mockImplementation(async () => {
      n += 1;
      rec(`P2 drain-body#${n}`);
      if (n === 1) throw new Error('boom');
      return { removed: 0, errors: 0, completed: true };
    });
    sessionIdContext.run('S-beta', () => {
      startNonInteractiveOpenAILogHousekeeping(
        makeConfig(path.join(qwenHome, 'p2'), 'S-beta'),
        makeSettings(),
      );
    });
    await vi.waitFor(() =>
      expect(LEDGER.filter((l) => l.startsWith('P2 timer'))).toHaveLength(1),
    );
    // Fire the retry timer by hand from inside a DIFFERENT bound context to
    // prove the drain re-entrance does not pick up the firing context.
    const timers = pendingRetry;
    expect(timers).toBeDefined();
    await new Promise<void>((resolve) => {
      sessionIdContext.run('S-timer-firer', () => {
        timers!();
        resolve();
      });
    });
    await vi.waitFor(() =>
      expect(LEDGER.filter((l) => l.includes('drain-body'))).toHaveLength(2),
    );
    dump('LEDGER_P2');
  });

  it('P3: FIFO pickup of a job enqueued from a second session context', async () => {
    LEDGER.length = 0;
    const first = path.join(qwenHome, 'p3a');
    const second = path.join(qwenHome, 'p3b');
    let release: ((v: unknown) => void) | undefined;
    mocks.cleanupOldOpenAILogs.mockImplementation(({ logDir }: { logDir: string }) => {
      rec(`P3 drain-body(${logDir === first ? 'A' : 'B'})`);
      if (logDir === first) {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve({ removed: 0, errors: 0, completed: true });
    });
    sessionIdContext.run('S-one', () => {
      startNonInteractiveOpenAILogHousekeeping(
        makeConfig(first, 'S-one'),
        makeSettings(),
      );
    });
    await vi.waitFor(() => expect(LEDGER).toHaveLength(1));
    sessionIdContext.run('S-two', () => {
      startNonInteractiveOpenAILogHousekeeping(
        makeConfig(second, 'S-two'),
        makeSettings(),
      );
    });
    release?.({ removed: 0, errors: 0, completed: true });
    await vi.waitFor(() => expect(LEDGER).toHaveLength(2));
    dump('LEDGER_P3');
    expect(LEDGER).toEqual([
      'P3 drain-body(A) ctx=<none>',
      'P3 drain-body(B) ctx=<none>',
    ]);
  });

  it('P4: stop mid-flight with a second job still queued (return->continue)', async () => {
    LEDGER.length = 0;
    const first = path.join(qwenHome, 'p4a');
    const second = path.join(qwenHome, 'p4b');
    let release: ((v: unknown) => void) | undefined;
    mocks.cleanupOldOpenAILogs.mockImplementation(
      ({ logDir, signal }: { logDir: string; signal?: AbortSignal }) => {
        rec(`P4 drain-body(${logDir === first ? 'A' : 'B'})`);
        if (logDir === first) {
          return new Promise((resolve) => {
            release = resolve;
            signal?.addEventListener('abort', () => {
              rec('P4 aborted');
              resolve({ removed: 0, errors: 0, completed: false });
            });
          });
        }
        return Promise.resolve({ removed: 0, errors: 0, completed: true });
      },
    );
    startNonInteractiveOpenAILogHousekeeping(
      makeConfig(first),
      makeSettings(),
    );
    await vi.waitFor(() => expect(LEDGER).toHaveLength(1));
    startNonInteractiveOpenAILogHousekeeping(
      makeConfig(second),
      makeSettings(),
    );
    rec('P4 stop-called');
    await stopNonInteractiveOpenAILogHousekeeping();
    release?.({ removed: 0, errors: 0, completed: false });
    await new Promise((r) => realSetTimeout(r, 50));
    dump('LEDGER_P4');
    // The queued second job must NOT run after stop.
    expect(LEDGER.filter((l) => l.includes('drain-body(B)'))).toHaveLength(0);
  });

  it('P5: incomplete + locked + fresh statuses reschedule identically', async () => {
    LEDGER.length = 0;
    const delays: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (typeof ms === 'number' && ms >= 1000) {
        delays.push(ms);
        rec(`P5 timer-register(${ms})`);
      }
      return realSetTimeout(fn, ms) as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;
    mocks.runThrottledOnce.mockImplementation(async () => ({
      status: 'fresh',
      retryAfterMs: 5000,
    }));
    mocks.cleanupOldOpenAILogs.mockImplementation(async () => {
      rec('P5 drain-body');
      return { removed: 0, errors: 0, completed: true };
    });
    startNonInteractiveOpenAILogHousekeeping(
      makeConfig(path.join(qwenHome, 'p5')),
      makeSettings(),
    );
    await vi.waitFor(() => expect(delays).toHaveLength(1));
    dump('LEDGER_P5');
    expect(delays).toEqual([60 * 1000]);
  });
  it('P6: REAL event-loop dispatch of the retry timer (production path)', async () => {
    LEDGER.length = 0;
    let n = 0;
    // Keep the event-loop dispatch faithful; only shrink the 10-minute delay
    // so the timer actually fires from the loop instead of being hand-called.
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms === 10 * 60 * 1000) {
        rec('P6 timer-register');
        return realSetTimeout(fn, 5) as unknown as NodeJS.Timeout;
      }
      return realSetTimeout(fn, ms) as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;

    mocks.cleanupOldOpenAILogs.mockImplementation(async () => {
      n += 1;
      rec(`P6 drain-body#${n}`);
      if (n === 1) throw new Error('boom');
      return { removed: 0, errors: 0, completed: true };
    });
    // Start from inside a bound ACP-shaped session context, exactly as
    // acpAgent.ts does in production.
    sessionIdContext.run('S-acp', () => {
      startNonInteractiveOpenAILogHousekeeping(
        makeConfig(path.join(qwenHome, 'p6'), 'S-acp'),
        makeSettings(),
      );
    });
    await vi.waitFor(
      () =>
        expect(LEDGER.filter((l) => l.includes('drain-body'))).toHaveLength(2),
      { timeout: 5000 },
    );
    dump('LEDGER_P6');
    expect(LEDGER).toEqual([
      'P6 drain-body#1 ctx=<none>',
      'P6 timer-register ctx=<none>',
      'P6 drain-body#2 ctx=<none>',
    ]);
  });
});

// Captures the pending retry callback registered by scheduleNonInteractiveJob.
let pendingRetry: (() => void) | undefined;
const _origSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void, ms?: number) => {
  if (ms === 10 * 60 * 1000) pendingRetry = fn;
  return _origSetTimeout(fn, ms) as unknown as NodeJS.Timeout;
}) as unknown as typeof setTimeout;
