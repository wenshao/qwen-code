#!/usr/bin/env python3
"""Instrument the target test to print the spy's call count at each step.
Variant 'head' = PR as filed; variant 'c1' = first commit only (no added clear)."""
import sys, pathlib
WT = pathlib.Path("/root/git/pr11406")
TEST = WT / "packages/web-shell/client/App.test.tsx"
variant = sys.argv[1]

HEAD_BLOCK = """      await act(async () => report(ownerIds));
      // Clear setup-time calls so the guard below measures only this rerender.
      mockUseDaemonSessionActivityBridge.mockClear();
      rerender();
"""
C1_BLOCK = """      await act(async () => report(ownerIds));
      rerender();
"""
N = "mockUseDaemonSessionActivityBridge.mock.calls.length"
TAG = "`[census outerPending=${outerPending}]`"

if variant == "head":
    new = f"""      console.log({TAG}, 'after setup+report:', {N});
      await act(async () => report(ownerIds));
      console.log({TAG}, 'after report(ownerIds):', {N});
      mockUseDaemonSessionActivityBridge.mockClear();
      console.log({TAG}, 'after ADDED mockClear:', {N});
      rerender();
      console.log({TAG}, 'after rerender():', {N}, '<- what the guard sees');
"""
    old = HEAD_BLOCK
else:
    new = f"""      console.log({TAG}, 'after setup+report:', {N});
      await act(async () => report(ownerIds));
      console.log({TAG}, 'after report(ownerIds):', {N});
      rerender();
      console.log({TAG}, 'after rerender():', {N}, '<- what the guard sees');
"""
    # first downgrade to the C1 shape
    src = TEST.read_text()
    assert src.count(HEAD_BLOCK) == 1
    src = src.replace(HEAD_BLOCK, C1_BLOCK)
    TEST.write_text(src)
    old = C1_BLOCK

src = TEST.read_text()
assert src.count(old) == 1, src.count(old)
TEST.write_text(src.replace(old, new))
print(f"instrumented ({variant})")
