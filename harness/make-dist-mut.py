#!/usr/bin/env python3
"""Build the MUT arm: a copy of the PR-head bundle with the seven
`backgroundTurn` guard terms that PR #12250 pins turned off.

Each edit names its bundle line, the exact text it expects there and the
statement it expects on the next line, so a stale line number aborts instead
of patching the wrong site.
"""
import pathlib, sys

chunk = pathlib.Path(sys.argv[1])
lines = chunk.read_text().split('\n')

EDITS = [
    # (1-based line, expected line text, expected next-line fragment, replacement line, label)
    (10224,
     '    return entry.pendingPromptCount > 0 || entry.pendingAgentNotificationCount > 0 || !!entry.backgroundTurn;',
     '  }',
     '    return entry.pendingPromptCount > 0 || entry.pendingAgentNotificationCount > 0 || false;',
     'entryHasLocalWork (src :2684)'),
    (15500,
     '      if (!isSideTask && (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn)) {',
     'throw new BranchWhilePromptActiveError(sessionId);',
     '      if (!isSideTask && (entry.pendingPromptCount > 0 || entry.promptActive || false)) {',
     'branch admission (src :10825)'),
    (15508,
     '        if ((entry.promptActive || entry.backgroundTurn) && !isSideTask) {',
     'throw new BranchWhilePromptActiveError(sessionId);',
     '        if ((entry.promptActive || false) && !isSideTask) {',
     'branch callback (src :10836)'),
    (15774,
     '          if (entry.promptActive || entry.backgroundTurn) {',
     'throw new CdWhilePromptActiveError(sessionId);',
     '          if (entry.promptActive || false) {',
     'cd guard (src :11182)'),
    (17554,
     '      if (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn) {',
     'throw new SessionBusyError(',
     '      if (entry.pendingPromptCount > 0 || entry.promptActive || false) {',
     'fork admission (src :13663)'),
    (17561,
     '        if (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn) {',
     'throw new SessionBusyError(',
     '        if (entry.pendingPromptCount > 0 || entry.promptActive || false) {',
     'fork callback (src :13674)'),
    (17765,
     '      if (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn) {',
     'throw new SessionBusyError(',
     '      if (entry.pendingPromptCount > 0 || entry.promptActive || false) {',
     'rewind admission (src :13942)'),
]

for ln, expect, nxt, repl, label in EDITS:
    i = ln - 1
    if lines[i] != expect:
        sys.exit(f'line {ln} ({label}) does not match: {lines[i]!r}')
    if nxt not in lines[i + 1]:
        sys.exit(f'line {ln + 1} ({label}) next-line mismatch: {lines[i + 1]!r}')
    lines[i] = repl
    print(f'patched {label} at bundle line {ln}')

# the fork guards are told apart by the message two lines below
for ln in (17554, 17561):
    assert 'Cannot fork while' in '\n'.join(lines[ln:ln + 4]), ln
assert 'Cannot rewind while' in '\n'.join(lines[17765:17769])

chunk.write_text('\n'.join(lines))
