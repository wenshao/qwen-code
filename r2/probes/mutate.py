"""Apply one PR #11792 mutation to a qwen-live package tree.

The same label mutates the PR arm's single shared gate
(src/private-directory.ts) and main's three inline copies
(monitor-debug-store.ts, discovery.ts x2), so the two arms answer the same
question: does this arm's test suite notice?
"""

import pathlib
import sys

PKG = pathlib.Path(sys.argv[1])
LABEL = sys.argv[2]
SHARED = PKG / 'src/private-directory.ts'
STORE = PKG / 'src/proactive/monitor-debug-store.ts'
DISCOVERY = PKG / 'src/host/discovery.ts'
IS_PR_ARM = SHARED.exists()

# label -> (old, new, count-on-PR-arm, count-on-main-arm)
PLAIN = {
    'win32-guard-always-on': ("process.platform !== 'win32' &&", 'true &&', 1, 3),
    'win32-guard-inverted': ("process.platform !== 'win32' &&", 'false &&', 1, 3),
    'uid-check-disabled': ("typeof process.getuid === 'function' &&", 'false &&', 1, 3),
    'symlink-check-disabled': ('stat.isSymbolicLink()', 'false', 1, 3),
    'isdirectory-check-disabled': ('!stat.isDirectory()', 'false', 1, 3),
}

# Mutate only inside the gate functions: `process.platform !== 'win32'` and
# `stat.isSymbolicLink()` also appear in unrelated helpers (the post-mkdir
# chmod, for one), and rewriting those would measure a different thing.
TARGETS = (
    [(SHARED, 'export async function privateDirectoryStat(')]
    if IS_PR_ARM
    else [
        (STORE, 'async function privateDirectory(path: string): Promise<void> {'),
        (DISCOVERY, 'async function inspectDirectory('),
        (DISCOVERY, 'async function assertLockShapeIfPresent('),
    ]
)


def apply(path, old, new, expected):  # whole-file, for the unique anchors
    text = path.read_text()
    found = text.count(old)
    if found == 0:
        return 0
    path.write_text(text.replace(old, new))
    return found


def apply_in_function(path, header, old, new):
    text = path.read_text()
    start = text.index(header)
    end = text.index('\n}\n', start) + 3
    body = text[start:end]
    found = body.count(old)
    if found == 0:
        return 0
    path.write_text(text[:start] + body.replace(old, new) + text[end:])
    return found


def run_plain(label):
    old, new, want_pr, want_main = PLAIN[label]
    want = want_pr if IS_PR_ARM else want_main
    total = 0
    for path, header in TARGETS:
        total += apply_in_function(path, header, old, new)
    if total != want:
        print(f'{label}: replaced {total}, expected {want}', file=sys.stderr)
        sys.exit(1)


def run_owner_only_disabled():
    if IS_PR_ARM:
        old = "modeCheck === 'owner-only' && (stat.mode & 0o077) !== 0"
        new = "modeCheck === 'owner-only' && false"
        want, target = 1, SHARED
    else:
        old = '(stat.mode & 0o077) !== 0 ||'
        new = 'false ||'
        want, target = 1, STORE
    if apply(target, old, new, want) != want:
        print('owner-only mutation missed', file=sys.stderr)
        sys.exit(1)


def run_exact0700_disabled():
    if IS_PR_ARM:
        old = "modeCheck === 'exact-0700' && (stat.mode & 0o777) !== 0o700"
        new = "modeCheck === 'exact-0700' && false"
        target = SHARED
    else:
        old = 'requirePrivateMode && (stat.mode & 0o777) !== 0o700'
        new = 'requirePrivateMode && false'
        target = DISCOVERY
    if apply(target, old, new, 1) != 1:
        print('exact-0700 mutation missed', file=sys.stderr)
        sys.exit(1)


def run_lockshape_gate_disabled():
    # Neutralise assertLockShapeIfPresent entirely: any test that claims to
    # exercise the lock-shape gate must go red.
    header = 'async function assertLockShapeIfPresent(lockPath: string): Promise<void> {'
    text = DISCOVERY.read_text()
    if text.count(header) != 1:
        print('lockshape anchor not found', file=sys.stderr)
        sys.exit(1)
    DISCOVERY.write_text(text.replace(header, header + '\n  if (lockPath) return;'))


def run_strictness_swapped():
    if not IS_PR_ARM:
        print('strictness-swapped has no counterpart on main', file=sys.stderr)
        sys.exit(3)
    text = SHARED.read_text()
    old = (
        "((modeCheck === 'owner-only' && (stat.mode & 0o077) !== 0) ||\n"
        "      (modeCheck === 'exact-0700' && (stat.mode & 0o777) !== 0o700) ||"
    )
    new = (
        "((modeCheck === 'owner-only' && (stat.mode & 0o777) !== 0o700) ||\n"
        "      (modeCheck === 'exact-0700' && (stat.mode & 0o077) !== 0) ||"
    )
    if text.count(old) != 1:
        print('strictness-swapped: anchor not found', file=sys.stderr)
        sys.exit(1)
    SHARED.write_text(text.replace(old, new))


if LABEL in PLAIN:
    run_plain(LABEL)
elif LABEL == 'owner-only-disabled':
    run_owner_only_disabled()
elif LABEL == 'exact0700-disabled':
    run_exact0700_disabled()
elif LABEL == 'lockshape-gate-disabled':
    run_lockshape_gate_disabled()
elif LABEL == 'strictness-swapped':
    run_strictness_swapped()
else:
    print(f'unknown label {LABEL}', file=sys.stderr)
    sys.exit(1)
