#!/usr/bin/env python3
"""Variants of the retention test ('retains a detached session whose only work
is an admitted background turn') in bridge.test.ts.  Works on both the
previous head's version (301dbdbeea) and the new head's (02665c2cf7) where
the anchor exists; every edit must match exactly once.
  nosnap : drop the fresh empty active-work snapshot sent before detaching
  noctrl : drop the end_turn positive control
  sub    : attach an event subscriber before detaching (fixture drift)
  reap0  : sessionReapIntervalMs: 0 (reaper off)
  legacy : drop initializeImpl (back to the non-negotiating fixture)
Usage: variants2.py <bridge.test.ts> <variant>
"""
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
start = s.index("    it('retains a detached session whose only work is an admitted background turn'")
end = s.index("    it('negotiates the capability and counts accepted prompts locally'")
body = s[start:end]
def sub(old, new):
    global body
    n = body.count(old)
    assert n == 1, (n, old)
    body = body.replace(old, new)
v = sys.argv[2]
if v == 'nosnap':
    sub("      await sendActiveWorkSnapshot(handle, 1, [\n        { sessionId: session.sessionId, holds: [] },\n      ]);\n", "")
elif v == 'noctrl':
    sub("      await handle.agentConnection.extNotification('_qwencode/end_turn', {\n        sessionId: session.sessionId,\n        source: 'background_notification',\n        reason: 'end_turn',\n        turnId: admittedBackgroundTurn.turnId,\n      });\n      await vi.waitFor(() => expect(bridge.sessionCount).toBe(0));\n\n", "")
elif v == 'sub':
    sub("      await bridge.detachClient(session.sessionId, session.clientId);\n",
        "      const subAbort = new AbortController();\n"
        "      const subIter = bridge.subscribeEvents(session.sessionId, { signal: subAbort.signal });\n"
        "      void subIter[Symbol.asyncIterator]().next().catch(() => {});\n"
        "      await vi.waitFor(() =>\n"
        "        expect(bridge.getDaemonStatusSnapshot().sessions[0]?.subscriberCount).toBe(1),\n"
        "      );\n"
        "      await bridge.detachClient(session.sessionId, session.clientId);\n")
elif v == 'reap0':
    sub("        sessionReapIntervalMs: 10,\n", "        sessionReapIntervalMs: 0,\n")
elif v == 'legacy':
    sub("        initializeImpl: () => activeWorkInitializeResponse(),\n", "")
elif v == 'r42':
    sub("      await vi.waitFor(() => expect(bridge.sessionCount).toBe(0));\n\n      await bridge.shutdown();",
        "      await vi.waitFor(() => expect(bridge.sessionCount).toBe(0));\n      expect(conditionalCloseCalls).toBe(1);\n\n      await bridge.shutdown();")
elif v == 'r41':
    tpl = """
    it('R41 rejects __OP__ synchronously, not behind queued work, while an admitted background turn is running', async () => {
      const hangingCd = deferred<unknown>();
      const handle = makeChannel({
        extMethodImpl: (method) =>
          method === SERVE_CONTROL_EXT_METHODS.sessionCd ? hangingCd.promise : Promise.resolve({}),
      });
      const bridge = makeBridge({ channelFactory: async () => handle.channel });
      const session = await bridge.spawnOrAttach({ workspaceCwd: WS_A });
      const cdPromise = bridge.changeSessionCwd(session.sessionId, { path: WS_B });
      void cdPromise.catch(() => {});
      await expect(
        handle.agentConnection.extMethod('_qwencode/start_turn', {
          sessionId: session.sessionId,
          source: 'background_notification',
          ...admittedBackgroundTurn,
        }),
      ).resolves.toEqual({ accepted: true });
      await expect(
        Promise.race([
          __CALL__,
          new Promise((r) => setTimeout(() => r('queued'), 500)),
        ]),
      ).rejects.toBeInstanceOf(__ERR__);
      hangingCd.resolve({});
      await cdPromise.catch(() => {});
      await bridge.shutdown();
    });
"""
    t1 = tpl.replace('__OP__', 'branch').replace('__CALL__', 'bridge.branchSession(session.sessionId, {})').replace('__ERR__', 'BranchWhilePromptActiveError')
    t2 = tpl.replace('__OP__', 'fork').replace('__CALL__', "bridge.launchSessionForkAgent(session.sessionId, 'review this')").replace('__ERR__', 'SessionBusyError')
    body = body + t1 + t2
else:
    sys.exit('unknown variant ' + v)
p.write_text(s[:start] + body + s[end:])
print('variant', v, 'applied')
