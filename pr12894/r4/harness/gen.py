#!/usr/bin/env python3
"""Deterministic generators for the round-4 stderr-preview sibling sweep.

Every mode writes stdout first and stderr last, so the final stderr line is the
thing a read-order tail must not lose. Byte counts are exact.

usage:
  gen.py mixed   <stdoutBytes> <stderrPadBytes> <marker> <nl:0|1>
  gen.py oneline <stdoutBytes> <stderrLineBytes> <marker>
  gen.py cjk     <stdoutBytes> <stderrTotalBytes> <marker>
  gen.py interleave <pairs> <marker>
"""
import sys

mode = sys.argv[1]
out = sys.stdout.buffer
err = sys.stderr.buffer


def flush_both():
    out.flush()
    err.flush()


if mode == 'mixed':
    n_out, pad, marker, nl = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5] == '1'
    out.write(b'o' * n_out)
    flush_both()
    err.write(b'w' * pad)
    err.write(marker.encode() + (b'\n' if nl else b''))
    flush_both()
elif mode == 'oneline':
    n_out, line, marker = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    out.write(b'o' * n_out)
    flush_both()
    mb = marker.encode() + b'\n'
    err.write(b'L' * max(0, line - len(mb)) + mb)
    flush_both()
elif mode == 'cjk':
    n_out, total, marker = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    out.write(b'o' * n_out)
    flush_both()
    mb = marker.encode()
    pad = '\u9519' * ((total - len(mb)) // 3 + 1)
    pb = pad.encode()[: max(0, total - len(mb))]
    err.write(pb + mb)
    flush_both()
elif mode == 'interleave':
    pairs, marker = int(sys.argv[2]), sys.argv[3]
    for i in range(pairs):
        out.write(b'stdout line %d padding padding padding\n' % i)
        err.write(b'stderr line %d\n' % i)
    err.write(marker.encode() + b'\n')
    flush_both()
else:
    raise SystemExit('unknown mode ' + mode)
sys.exit(3)
