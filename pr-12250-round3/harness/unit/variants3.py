#!/usr/bin/env python3
"""Build test-file variants of bridge.test.ts @ fe6ca099 for the open bot threads.
  r3fix  = R5-2 rewind row + R5-3 rename + R6-1 projection assertion (all three suggestions)
  r3settled = R5-3's hazard: queued-cd fixture edited to match the current name
              (cd resolved and awaited before the turn is admitted)
Usage: variants3.py <in bridge.test.ts> <variant> <out>
"""
import sys
src, var, out = sys.argv[1:4]
s = open(src).read()
def sub(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit(f'{var}: expected 1 match, got {n}: {old[:60]!r}')
    s = s.replace(old, new)

if var == 'r3fix':
    # R5-2: add the rewind row to the queued-cd table
    sub("""        errorType: BranchWhilePromptActiveError,
      },
      {
        operation: 'fork',
        invoke: (bridge: ReturnType<typeof makeBridge>, sessionId: string) =>
          bridge.launchSessionForkAgent(sessionId, 'review this'),
        errorType: SessionBusyError,
      },
    ])(
      'rejects $operation synchronously before a queued cd""",
"""        errorType: BranchWhilePromptActiveError,
      },
      {
        operation: 'rewind',
        invoke: (bridge: ReturnType<typeof makeBridge>, sessionId: string) =>
          bridge.rewindSession(sessionId, { promptId: 'prompt-1' }),
        errorType: SessionBusyError,
      },
      {
        operation: 'fork',
        invoke: (bridge: ReturnType<typeof makeBridge>, sessionId: string) =>
          bridge.launchSessionForkAgent(sessionId, 'review this'),
        errorType: SessionBusyError,
      },
    ])(
      'rejects $operation synchronously before a queued cd""")
    # R5-3: rename
    sub("'rejects $operation synchronously before a queued cd can dispatch during a background turn'",
        "'rejects $operation synchronously instead of queueing behind an in-flight cd during a background turn'")
    # R6-1: projection assertion while the detached session is retained
    sub("""      await bridge.detachClient(session.sessionId, session.clientId);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(conditionalCloseCalls).toBe(0);
      expect(bridge.sessionCount).toBe(1);

      await handle.agentConnection.extNotification('_qwencode/end_turn', {
""", """      await bridge.detachClient(session.sessionId, session.clientId);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(conditionalCloseCalls).toBe(0);
      expect(bridge.sessionCount).toBe(1);
      expect(bridge.getSessionSummary(session.sessionId).activeWorkState).toBe(
        'active',
      );

      await handle.agentConnection.extNotification('_qwencode/end_turn', {
""")
elif var == 'r3settled':
    sub("""              method: SERVE_CONTROL_EXT_METHODS.sessionCd,
            }),
          ),
        );

        await expect(""", """              method: SERVE_CONTROL_EXT_METHODS.sessionCd,
            }),
          ),
        );
        hangingCd.resolve({ previousCwd: WS_A, newCwd: WS_B, warnings: [] });
        await cd;

        await expect(""")
else:
    sys.exit('unknown variant')
open(out, 'w').write(s)
print(f'{var}: wrote {out}')
