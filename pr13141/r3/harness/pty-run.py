#!/usr/bin/env python3
"""Run a command in a real pty with a forced terminal width.

The PR's test asserts on yargs help output, and yargs takes its wrap width from
process.stdout.columns. Round 1 found the first commit's test failed at EVERY
width for that reason; the current test squashes whitespace first, which should
make it width-independent. That is a claim about an environment-sensitive path,
so it gets re-measured at a narrow and a wide pty instead of being carried
forward from round 2.

tmux send-keys proved unreliable here (the pane never ran the command), so this
drives the pty directly with TIOCSWINSZ.

Usage: pty-run.py <cols> <rows> <outfile> -- <cmd> [args...]
Exit status is the child's.
"""

import errno
import fcntl
import os
import pty
import select
import struct
import sys
import termios

cols = int(sys.argv[1])
rows = int(sys.argv[2])
outfile = sys.argv[3]
assert sys.argv[4] == "--", "expected '--' separator"
cmd = sys.argv[5:]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
    os._exit(127)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

chunks = []
while True:
    try:
        r, _, _ = select.select([fd], [], [], 1.0)
    except (OSError, ValueError):
        break
    if not r:
        done, _ = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        continue
    try:
        data = os.read(fd, 65536)
    except OSError as e:
        if e.errno == errno.EIO:
            break
        raise
    if not data:
        break
    chunks.append(data)

_, status = os.waitpid(pid, 0)
raw = b"".join(chunks)
with open(outfile, "wb") as f:
    f.write(raw)

text = raw.decode("utf-8", "replace")
# Report what width the child actually saw, so a silent fallback to 80 columns
# cannot pass for a real narrow/wide run.
print(f"pty cols={cols} rows={rows} captured={len(raw)}B child_exit={os.waitstatus_to_exitcode(status)}")
for line in text.splitlines():
    if "Test Files" in line or "Tests " in line or "Duration" in line:
        print("  " + line.strip())
sys.exit(os.waitstatus_to_exitcode(status))
