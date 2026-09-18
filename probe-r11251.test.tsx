// @vitest-environment jsdom
/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maintainer verification probe for PR #11251, review finding R11-1.
 *
 * Feeds the production projection two transcript shapes whose only unusual
 * member is a `meta.source: 'vision_bridge_notice'` assistant block stamped
 * with the settling prompt's id — the shape `MessageEmitter.emitVisionBridgeNotice`
 * produces and `bridgeClient` stamps. Both cases assert the behaviour the
 * contract field promises ("Final visible assistant message"), so they are red
 * on the reviewed head and green once the guard excludes the notice sources.
 *
 * Not part of the PR; kept out of the repo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { DaemonTranscriptBlock } from '@qwen-code/sdk/daemon';
import type { WebShellAssistantTurnSettledEvent } from './customization';
import type {
  DaemonPromptSettledEvent,
  DaemonPromptSettledListener,
} from './daemon/session/types';

const harness = vi.hoisted(() => ({
  sessionId: undefined as string | undefined,
  blocks: [] as readonly unknown[],
  listener: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock('@qwen-code/web-shell/daemon-react-sdk', () => ({
  useConnection: () => ({ sessionId: harness.sessionId }),
  useTranscriptStore: () => ({
    getSnapshot: () => ({ blocks: harness.blocks }),
  }),
}));

vi.mock('./daemon/session/DaemonSessionProvider.js', () => ({
  useDaemonPromptSettled: (listener: unknown) => {
    harness.listener = listener as (event: unknown) => void;
  },
}));

import { AssistantTurnSettlementObserver } from './assistant-turn-settlement';
import { cleanupReact, mountReact } from './test/reactHarness';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function assistantBlock(
  id: string,
  text: string,
  init: {
    promptId?: string;
    meta?: Record<string, unknown>;
    streaming?: boolean;
  } = {},
): DaemonTranscriptBlock {
  return {
    id,
    kind: 'assistant',
    text,
    clientReceivedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    streaming: false,
    ...init,
  } as unknown as DaemonTranscriptBlock;
}

describe('R11-1 probe: meta.source notices in the settled-message scan', () => {
  let published: WebShellAssistantTurnSettledEvent[] = [];

  beforeEach(() => {
    published = [];
    harness.sessionId = 'session-1';
    harness.blocks = [];
    harness.listener = undefined;
  });

  afterEach(() => {
    cleanupReact();
  });

  function mountAndSettle(event: DaemonPromptSettledEvent) {
    mountReact(
      <AssistantTurnSettlementObserver
        onAssistantTurnSettled={(settled) => {
          published.push(settled);
        }}
      />,
    );
    const listener = harness.listener as
      | DaemonPromptSettledListener
      | undefined;
    if (!listener) throw new Error('observer did not subscribe');
    act(() => {
      listener(event);
    });
    return published;
  }

  it('does not publish a vision bridge notice that trails the real answer', () => {
    harness.blocks = [
      assistantBlock('assistant-1', 'Real answer text.', {
        promptId: 'prompt-live',
      }),
      assistantBlock('notice-2', 'Vision bridge: converted 1 image', {
        promptId: 'prompt-live',
        meta: { source: 'vision_bridge_notice', qwenDiscreteMessage: true },
      }),
    ];
    const [event] = mountAndSettle({
      sessionId: 'session-1',
      promptId: 'prompt-live',
      outcome: 'cancelled',
      stopReason: 'cancelled',
    });
    // eslint-disable-next-line no-console
    console.log('PROBE_TRAILING_NOTICE', JSON.stringify(event));
    expect(event?.message?.content).toBe('Real answer text.');
  });

  it('publishes no message when a vision bridge notice is the only stamped block', () => {
    harness.blocks = [
      assistantBlock('notice-1', 'Vision bridge: converted 1 image', {
        promptId: 'prompt-live',
        meta: { source: 'vision_bridge_notice', qwenDiscreteMessage: true },
      }),
    ];
    const [event] = mountAndSettle({
      sessionId: 'session-1',
      promptId: 'prompt-live',
      outcome: 'completed',
      stopReason: 'max_tokens',
    });
    // eslint-disable-next-line no-console
    console.log('PROBE_NOTICE_ONLY', JSON.stringify(event));
    expect(event?.message).toBeUndefined();
  });

  it('does not publish a background notification block as the turn answer', () => {
    harness.blocks = [
      assistantBlock('notice-1', 'Background task finished', {
        promptId: 'prompt-live',
        meta: { source: 'background_notification' },
      }),
    ];
    const [event] = mountAndSettle({
      sessionId: 'session-1',
      promptId: 'prompt-live',
      outcome: 'completed',
      stopReason: 'end_turn',
    });
    // eslint-disable-next-line no-console
    console.log('PROBE_BACKGROUND_ONLY', JSON.stringify(event));
    expect(event?.message).toBeUndefined();
  });
});
