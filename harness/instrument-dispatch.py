#!/usr/bin/env python3
"""Observation only: log one stderr line right before the bridge dispatches a
branch / fork / rewind / cd to the ACP child.  No control flow changes.
Inserted bottom-up so earlier line numbers stay valid."""
import pathlib, sys

chunk = pathlib.Path(sys.argv[1])
lines = chunk.read_text().split('\n')

SITES = [
    # (1-based line to insert BEFORE, expected text at that line, expected text on a following line, op)
    (17777, '          response = await Promise.race([', 'SERVE_CONTROL_EXT_METHODS.sessionRewind', 'rewind'),
    (17573, '          response = await Promise.race([', 'SERVE_CONTROL_EXT_METHODS.sessionForkAgent', 'fork'),
    (15531, '          const mutation = entry.connection.extMethod(', 'SERVE_CONTROL_EXT_METHODS.sessionBranch', 'branch'),
    (1441, '      return channel.connection.extMethod(SERVE_CONTROL_EXT_METHODS.sessionCd, {', 'SERVE_CONTROL_EXT_METHODS.sessionCd', 'cd'),
]
for ln, expect, follow, op in sorted(SITES, reverse=True):
    i = ln - 1
    if lines[i] != expect:
        sys.exit(f'{op}: line {ln} mismatch: {lines[i]!r}')
    if follow not in '\n'.join(lines[i:i + 5]):
        sys.exit(f'{op}: {follow} not within 5 lines of {ln}')
    indent = expect[: len(expect) - len(expect.lstrip())]
    lines.insert(i, f'{indent}process.stderr.write("[probe-dispatch] {op} -> child sessionId=" + sessionId + "\\n");')
    print(f'instrumented {op} before bundle line {ln}')
chunk.write_text('\n'.join(lines))
