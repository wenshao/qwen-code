#!/usr/bin/env python3
"""Instrument the split-session test to print the spy's call count at each step.

Shows WHY the PR's version of the positive guard is satisfiable by stale setup-time
calls while main's extra mockClear() makes it measure only the rerender.
"""
import sys, pathlib
TEST = pathlib.Path('/root/git/pr11412/packages/web-shell/client/App.test.tsx')
S = 'mockUseDaemonSessionActivityBridge'
s = TEST.read_text()

anchor = f"""      await act(async () => report(ownerIds));
"""
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + f'      console.log(`[CENSUS ${{outerPending}}] after-first-report calls=${{{S}.mock.calls.length}}`);\n')

anchor2 = f"""      expect(testState.latestSplitViewProps!.onPendingPanesChange).toBe(report);
      expect({S}).toHaveBeenCalled();
"""
assert s.count(anchor2) == 1
s = s.replace(anchor2, f"""      expect(testState.latestSplitViewProps!.onPendingPanesChange).toBe(report);
      console.log(`[CENSUS ${{outerPending}}] at-positive-guard calls=${{{S}.mock.calls.length}}`);
      expect({S}).toHaveBeenCalled();
""")
TEST.write_text(s)
print('instrumented')
