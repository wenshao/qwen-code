#!/usr/bin/env python3
"""Variants of the PR's retention test (bridge.test.ts, 'retains a detached
session whose only work is an admitted background turn').

  cand    : candidate repair = negotiate the full active-work capability (so the
            conditional-close counter is live) + an end_turn positive control
  reap0   : the test as shipped, but sessionReapIntervalMs: 0 (reaper off)
Usage: retention-variants.py <bridge.test.ts> <variant>
"""
import pathlib, sys

p = pathlib.Path(sys.argv[1])
s = p.read_text()
start = s.index("    it('retains a detached session whose only work is an admitted background turn'")
end = s.index("    it('negotiates the capability and counts accepted prompts locally'")
body = s[start:end]


def sub(old, new):
    global body
    assert body.count(old) == 1, old
    body = body.replace(old, new)


v = sys.argv[2]
if v == 'cand':
    sub("      const handle = makeChannel({\n        extMethodImpl: async (method, params) => {",
        "      const handle = makeChannel({\n        initializeImpl: () => activeWorkInitializeResponse(),\n        extMethodImpl: async (method, params) => {")
    sub("      expect(conditionalCloseCalls).toBe(0);\n      expect(bridge.sessionCount).toBe(1);\n\n      await bridge.shutdown();",
        "      expect(conditionalCloseCalls).toBe(0);\n      expect(bridge.sessionCount).toBe(1);\n\n"
        "      // Positive control: the same detached, unsubscribed session goes once\n"
        "      // the background turn ends, so the retention above was the turn.\n"
        "      await handle.agentConnection.extNotification('_qwencode/end_turn', {\n"
        "        sessionId: session.sessionId,\n"
        "        source: 'background_notification',\n"
        "        reason: 'end_turn',\n"
        "        turnId: admittedBackgroundTurn.turnId,\n"
        "      });\n"
        "      await vi.waitFor(() => expect(bridge.sessionCount).toBe(0));\n\n"
        "      await bridge.shutdown();")
elif v == 'reap0':
    sub("        sessionReapIntervalMs: 10,\n        sessionIdleTimeoutMs: 10,\n      });\n      const session = await bridge.spawnOrAttach({ workspaceCwd: WS_A });\n      await expect(",
        "        sessionReapIntervalMs: 0,\n        sessionIdleTimeoutMs: 10,\n      });\n      const session = await bridge.spawnOrAttach({ workspaceCwd: WS_A });\n      await expect(")
else:
    sys.exit('unknown variant')
p.write_text(s[:start] + body + s[end:])
print('variant', v, 'applied')
