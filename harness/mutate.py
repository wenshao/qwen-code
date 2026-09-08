#!/usr/bin/env python3
"""Apply one named mutation to the PR-head working tree (restore with git checkout HEAD --)."""
import sys, pathlib

WT = pathlib.Path("/root/git/pr11406")
TEST = WT / "packages/web-shell/client/App.test.tsx"
APP = WT / "packages/web-shell/client/App.tsx"

GUARD_BLOCK = """      await act(async () => report(ownerIds));
      // Clear setup-time calls so the guard below measures only this rerender.
      mockUseDaemonSessionActivityBridge.mockClear();
      rerender();
      expect(testState.latestSplitViewProps!.onPendingPanesChange).toBe(report);
      expect(mockUseDaemonSessionActivityBridge).toHaveBeenCalled();
      mockUseDaemonSessionActivityBridge.mockClear();
"""

# The same block as it exists on commit 2f693f42f6 (fix without the added clear).
GUARD_BLOCK_C1 = """      await act(async () => report(ownerIds));
      rerender();
      expect(testState.latestSplitViewProps!.onPendingPanesChange).toBe(report);
      expect(mockUseDaemonSessionActivityBridge).toHaveBeenCalled();
      mockUseDaemonSessionActivityBridge.mockClear();
"""

HOOK_CALL = """  const {
    hasActivePrompt: sessionHasActivePrompt,
    activeWorkState: sessionActiveWorkState,
  } = useDaemonSessionActivityBridge(
    workspace.client,
    activePromptWorkspaceCwd,
    connection.sessionId,
  );
"""

HANDLER = """  const handleSplitPendingPanesChange = useCallback(
    (ids: string[]) =>
      setOuterSplitPanePending(ids.includes(connection.sessionId ?? '')),
    [connection.sessionId],
  );
"""


def sub(path, old, new, name):
    src = path.read_text()
    n = src.count(old)
    if n != 1:
        sys.exit(f"MUTATION {name}: anchor found {n} times in {path.name} (expected 1)")
    path.write_text(src.replace(old, new))
    print(f"applied {name} -> {path.name}")


MUTS = {
    # --- test-side mutations (simulate the regression the test claims to catch)
    "R-del-rerender": lambda: sub(
        TEST, GUARD_BLOCK, GUARD_BLOCK.replace("      rerender();\n", ""), "R-del-rerender"
    ),
    "R-del-rerender-C1": lambda: (
        sub(TEST, GUARD_BLOCK, GUARD_BLOCK_C1, "downgrade-to-C1"),
        sub(TEST, GUARD_BLOCK_C1, GUARD_BLOCK_C1.replace("      rerender();\n", ""), "R-del-rerender-C1"),
    ),
    "T-del-trailing-clear": lambda: sub(
        TEST,
        GUARD_BLOCK,
        GUARD_BLOCK[: GUARD_BLOCK.rindex("      mockUseDaemonSessionActivityBridge.mockClear();\n")],
        "T-del-trailing-clear",
    ),
    "X-clear-to-reset": lambda: sub(
        TEST,
        "      // Clear setup-time calls so the guard below measures only this rerender.\n      mockUseDaemonSessionActivityBridge.mockClear();\n      rerender();",
        "      // Clear setup-time calls so the guard below measures only this rerender.\n      mockUseDaemonSessionActivityBridge.mockReset();\n      rerender();",
        "X-clear-to-reset",
    ),
    # --- production-side mutations
    "P1-drop-hook-call": lambda: sub(
        APP,
        HOOK_CALL,
        "  const sessionHasActivePrompt = false;\n  const sessionActiveWorkState = undefined;\n",
        "P1-drop-hook-call",
    ),
    "P2-force-rerender": lambda: sub(
        APP,
        HANDLER,
        """  const handleSplitPendingPanesChange = useCallback(
    (_ids: string[]) => setOuterSplitPanePending((prev) => !prev),
    [connection.sessionId],
  );
""",
        "P2-force-rerender",
    ),
    # --- control: downgrade the test file to commit 1 only (no added clear), unmutated
    "C1-only": lambda: sub(TEST, GUARD_BLOCK, GUARD_BLOCK_C1, "C1-only"),
}

if __name__ == "__main__":
    name = sys.argv[1]
    if name not in MUTS:
        sys.exit(f"unknown mutation {name}; known: {', '.join(MUTS)}")
    MUTS[name]()
