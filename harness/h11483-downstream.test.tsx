/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * R4 — downstream contract probe for PR #11483.
 *
 * Drives the REAL useReactToolScheduler hook over a REAL CoreToolScheduler that
 * is held busy by a real in-flight tool call, then schedules a second request
 * whose AbortSignal was aborted BEFORE schedule() was called — once through the
 * normal branch and once through the full-turn (`modelOverride` ending in \0)
 * branch. Emits a JSON readout instead of asserting, so the same file can be run
 * unchanged against base and against the PR.
 */
import { appendFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type { Config, ToolRegistry, ToolResult } from '@qwen-code/qwen-code-core';
import {
  ApprovalMode,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  MockTool,
} from '@qwen-code/qwen-code-core';

const mockToolRegistry = {
  getTool: vi.fn(),
  ensureTool: vi.fn(async (name: string) => mockToolRegistry.getTool(name)),
  getAllToolNames: vi.fn(() => ['holdTool']),
  getFunctionDeclarations: () => [],
};

const baseLlmClient = {
  resolveForModel: vi.fn(async () => ({ model: 'vision-model' })),
};

const mockConfig = {
  getToolRegistry: vi.fn(() => mockToolRegistry as unknown as ToolRegistry),
  getApprovalMode: vi.fn(() => ApprovalMode.YOLO),
  getSessionId: () => 'h11483',
  getUsageStatisticsEnabled: () => false,
  getDebugMode: () => false,
  storage: { getProjectTempDir: () => '/tmp' },
  getTruncateToolOutputThreshold: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  getPermissionsAllow: vi.fn(() => []),
  getContentGeneratorConfig: () => ({ model: 'test-model', authType: 'gemini' }),
  getBaseLlmClient: vi.fn(() => baseLlmClient),
  getUseModelRouter: () => false,
  getLlmClient: () => null,
  getShellExecutionConfig: () => ({ terminalWidth: 80, terminalHeight: 24 }),
  getChatRecordingService: vi.fn(() => undefined),
  getMessageBus: vi.fn().mockReturnValue(undefined),
  getDisableAllHooks: vi.fn().mockReturnValue(true),
  getHookSystem: vi.fn().mockReturnValue(undefined),
  getDebugLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
} as unknown as Config;

const flush = async (ms = 250) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

async function runProbe(
  branch: 'normal' | 'full-turn',
  timing: 'pre-abort' | 'post-enqueue' = 'pre-abort',
) {
  let releaseHold: (r: ToolResult) => void = () => {};
  const holdPromise = new Promise<ToolResult>((resolve) => {
    releaseHold = resolve;
  });
  const holdTool = new MockTool({
    name: 'holdTool',
    displayName: 'Hold Tool',
    execute: vi.fn().mockReturnValue(holdPromise),
  });
  mockToolRegistry.getTool.mockReturnValue(holdTool);

  const onComplete = vi.fn();
  // Stable identities: useReactToolScheduler re-creates its CoreToolScheduler
  // whenever any callback identity changes, and a fresh scheduler is never
  // "busy" — which would silently defeat the whole probe.
  const getPreferredEditor = () => undefined;
  const onEditorClose = () => {};
  const { result } = renderHook(() =>
    useReactToolScheduler(
      onComplete,
      mockConfig,
      getPreferredEditor,
      onEditorClose,
    ),
  );

  // Batch A: real call that holds the shared scheduler in `executing`.
  const holdController = new AbortController();
  act(() => {
    result.current[1](
      [
        {
          callId: 'hold-call',
          name: 'holdTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-hold',
        },
      ],
      holdController.signal,
    );
  });
  await flush();
  const busyStatuses = result.current[0].map((c: any) => c.status);

  // Batch B: aborted BEFORE schedule() (pre-abort) or AFTER it enqueued
  // (post-enqueue — the timing that is already reachable on base).
  const preAborted = new AbortController();
  if (timing === 'pre-abort') preAborted.abort();
  act(() => {
    result.current[1](
      [
        {
          callId: 'pre-aborted-call',
          name: 'holdTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-pre-aborted',
        },
      ],
      preAborted.signal,
      branch === 'full-turn' ? 'vision-model\0' : undefined,
    );
  });
  if (timing === 'post-enqueue') {
    await flush(150);
    act(() => {
      preAborted.abort();
    });
  }
  await flush(500);

  const displayWhileBusy = result.current[0].map((c: any) => ({
    callId: c.request.callId,
    status: c.status,
    errorType: c.response?.errorType,
    resultDisplay:
      typeof c.response?.resultDisplay === 'string'
        ? c.response.resultDisplay
        : undefined,
  }));
  const onCompleteWhileBusy = onComplete.mock.calls.map((call: any[]) =>
    call[0].map((c: any) => `${c.request.callId}:${c.status}:${c.response?.errorType ?? ''}`),
  );

  // Release batch A and let the queue drain.
  await act(async () => {
    releaseHold({ llmContent: 'hold done', returnDisplay: 'hold done' } as ToolResult);
    await new Promise((r) => setTimeout(r, 600));
  });

  const displayAfterRelease = result.current[0].map((c: any) => ({
    callId: c.request.callId,
    status: c.status,
    errorType: c.response?.errorType,
  }));
  const onCompleteAfterRelease = onComplete.mock.calls.map((call: any[]) =>
    call[0].map((c: any) => `${c.request.callId}:${c.status}:${c.response?.errorType ?? ''}`),
  );

  return {
    branch,
    timing,
    busyStatuses,
    displayWhileBusy,
    onCompleteWhileBusy,
    displayAfterRelease,
    onCompleteAfterRelease,
  };
}

describe('R4 downstream probe (PR #11483)', () => {
  it('normal branch', async () => {
    const out = await runProbe('normal');
    appendFileSync(process.env['R4_OUT']!, JSON.stringify(out) + '\n');
  }, 30000);

  it('full-turn branch', async () => {
    const out = await runProbe('full-turn');
    appendFileSync(process.env['R4_OUT']!, JSON.stringify(out) + '\n');
  }, 30000);

  it('full-turn branch, aborted after enqueue', async () => {
    const out = await runProbe('full-turn', 'post-enqueue');
    appendFileSync(process.env['R4_OUT']!, JSON.stringify(out) + '\n');
  }, 30000);
});
