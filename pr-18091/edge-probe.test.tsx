// @vitest-environment jsdom
// Two-arm measurement probe for PR 18091's onCancel ownership guard.
// It MEASURES the four settlement shapes and asserts only the positive
// control, so the base arm (no guard) runs to completion and reports its own
// counts.
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { SessionChatController } from './contract.js';
import { regionsToCapabilities } from './capabilities.js';

const captured = vi.hoisted(() => ({
  editor: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../components/TranscriptViewport.js', () => ({
  TranscriptViewport: () => <div />,
}));
vi.mock('../components/messages/ToolApproval.js', () => ({
  ToolApproval: () => <div />,
}));
vi.mock('../components/messages/AskUserQuestion.js', () => ({
  AskUserQuestion: () => <div />,
}));
vi.mock('../components/ChatEditor.js', () => ({
  ChatEditor: (props: Record<string, unknown>) => {
    captured.editor = props;
    return <div />;
  },
}));
vi.mock('../i18n.js', () => ({
  useI18n: () => ({ t: (key: string) => `localized:${key}` }),
}));

import { ChatSurface } from './ChatSurface.js';
import {
  cleanupReact,
  mountReact,
  rerenderReact,
} from '../test/reactHarness.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type CancelResult = { admission: string };

function fake(
  sessionId: string,
  cancel: () => Promise<CancelResult>,
): SessionChatController {
  return {
    kind: 'daemon',
    sessionId,
    storageKey: `draft:${sessionId}`,
    operations: [],
    messages: [],
    transcriptState: 'ready',
    phase: 'idle',
    submit: vi.fn(async () => ({ admission: 'accepted' })),
    cancel: vi.fn(cancel),
    pendingApprovals: [],
    pendingQuestions: [],
    respondApproval: vi.fn(async () => ({ admission: 'accepted' })),
    respondQuestion: vi.fn(async () => ({ admission: 'accepted' })),
    statusFacts: { queueLength: 0, goalActive: false },
    capabilities: regionsToCapabilities([]),
  } as unknown as SessionChatController;
}

const ok = () => fake('s2', async () => ({ admission: 'accepted' }));

describe('PR 18091 onCancel ownership probe', () => {
  it('measures settlement reporting shapes', async () => {
    // E1: durable A -> B, settle rejected while B is active, then return to A.
    {
      const onError = vi.fn();
      let rejectA: ((reason: unknown) => void) | undefined;
      const a = fake(
        's1',
        () =>
          new Promise<CancelResult>((_resolve, reject) => {
            rejectA = reject;
          }),
      );
      const b = ok();
      const c = mountReact(<ChatSurface controller={a} onError={onError} />);
      await act(async () => {
        (captured.editor?.onCancel as () => void)();
      });
      rerenderReact(c, <ChatSurface controller={b} onError={onError} />);
      await act(async () => {
        rejectA?.(new Error('transport failed'));
      });
      const whileAway = onError.mock.calls.length;
      rerenderReact(c, <ChatSurface controller={a} onError={onError} />);
      console.log(
        `E1 post-settlement-return whileAway=${whileAway} afterReturn=${onError.mock.calls.length}`,
      );
      cleanupReact();
    }

    // E2: cancel, unmount the surface, then settle rejected.
    {
      const onError = vi.fn();
      let rejectA: ((reason: unknown) => void) | undefined;
      const a = fake(
        's1',
        () =>
          new Promise<CancelResult>((_resolve, reject) => {
            rejectA = reject;
          }),
      );
      mountReact(<ChatSurface controller={a} onError={onError} />);
      await act(async () => {
        (captured.editor?.onCancel as () => void)();
      });
      cleanupReact();
      await act(async () => {
        rejectA?.(new Error('transport failed'));
      });
      console.log(`E2 after-unmount onError=${onError.mock.calls.length}`);
    }

    // E3: positive control — active session, rejected settlement.
    {
      const onError = vi.fn();
      const a = fake('s1', async () => ({ admission: 'rejected' }));
      mountReact(<ChatSurface controller={a} onError={onError} />);
      await act(async () => {
        (captured.editor?.onCancel as () => void)();
      });
      console.log(`E3 active-rejected onError=${onError.mock.calls.length}`);
      expect(onError).toHaveBeenCalledTimes(1);
      cleanupReact();
    }

    // E4: durable A -> B -> A, settle rejected after the round trip.
    {
      const onError = vi.fn();
      let rejectA: ((reason: unknown) => void) | undefined;
      const a = fake(
        's1',
        () =>
          new Promise<CancelResult>((_resolve, reject) => {
            rejectA = reject;
          }),
      );
      const b = ok();
      const c = mountReact(<ChatSurface controller={a} onError={onError} />);
      await act(async () => {
        (captured.editor?.onCancel as () => void)();
      });
      rerenderReact(c, <ChatSurface controller={b} onError={onError} />);
      rerenderReact(c, <ChatSurface controller={a} onError={onError} />);
      await act(async () => {
        rejectA?.(new Error('transport failed'));
      });
      console.log(`E4 roundtrip-before-settle onError=${onError.mock.calls.length}`);
      expect(onError).toHaveBeenCalledTimes(1);
      cleanupReact();
    }
  });
});
