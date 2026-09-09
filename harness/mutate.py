#!/usr/bin/env python3
"""Apply one named, exact-anchor mutation inside the PR worktree.

Each mutation asserts its anchor occurs EXACTLY once before rewriting, so an arm can
never silently no-op (which would fake a "mutant survived" result).
"""
import sys, pathlib

WT = pathlib.Path('/root/git/pr11412')
TEST = WT / 'packages/web-shell/client/App.test.tsx'
APP = WT / 'packages/web-shell/client/App.tsx'


def _sub(path, old, new, desc):
    s = path.read_text()
    n = s.count(old)
    assert n == 1, f'anchor occurs {n}x, expected 1 -- refusing to mutate ({desc})'
    path.write_text(s.replace(old, new))
    return desc


def drop_rerender():
    return _sub(
        TEST,
        '      rerender();\n      expect(testState.latestSplitViewProps!.onPendingPanesChange).toBe(report);\n',
        '      expect(testState.latestSplitViewProps!.onPendingPanesChange).toBe(report);\n',
        'test: delete rerender() (vacuity probe on the positive guard)',
    )


def clear_to_reset():
    return _sub(
        TEST,
        "      mockUseDaemonSessionActivityBridge.mockClear();\n      for (const ids of [['foreign-session'], ['another-session'], []]) {\n",
        "      mockUseDaemonSessionActivityBridge.mockReset();\n      for (const ids of [['foreign-session'], ['another-session'], []]) {\n",
        'test: mockClear() -> mockReset() before the negative loop',
    )


def prod_drop_owner_filter():
    return _sub(
        APP,
        "    (ids: string[]) =>\n      setOuterSplitPanePending(ids.includes(connection.sessionId ?? '')),\n",
        "    (ids: string[]) => setOuterSplitPanePending(ids.length > 0),\n",
        'prod: drop the owner-session filter in handleSplitPendingPanesChange',
    )


def prod_always_rerender():
    _sub(
        APP,
        '  const [outerSplitPanePending, setOuterSplitPanePending] = useState(false);\n',
        '  const [outerSplitPanePending, setOuterSplitPanePending] = useState(false);\n'
        '  const [, setMutantChurn] = useState(0);\n',
        'prod: add churn state',
    )
    return _sub(
        APP,
        "    (ids: string[]) =>\n      setOuterSplitPanePending(ids.includes(connection.sessionId ?? '')),\n",
        "    (ids: string[]) => {\n"
        "      setMutantChurn((n) => n + 1);\n"
        "      setOuterSplitPanePending(ids.includes(connection.sessionId ?? ''));\n"
        "    },\n",
        'prod: App rerenders on EVERY pending-pane report (owner or foreign)',
    )


MUTATIONS = {
    'drop-rerender': drop_rerender,
    'clear-to-reset': clear_to_reset,
    'prod-drop-owner-filter': prod_drop_owner_filter,
    'prod-always-rerender': prod_always_rerender,
}

if __name__ == '__main__':
    name = sys.argv[1]
    if name not in MUTATIONS:
        raise SystemExit(f'unknown mutation {name}; known: {sorted(MUTATIONS)}')
    print(MUTATIONS[name]())
