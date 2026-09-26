#!/usr/bin/env python3
"""Test-file variant of bridge.test.ts @ 7ab49d5e for PR #12250 round 4.
  r4settled = the R5-3 hazard on the renamed table: the queued-cd fixture is
              edited so the cd is resolved and awaited before the operation
              runs, i.e. the queue is no longer held (the precondition the new
              name states).
Usage: variants4.py <in bridge.test.ts> <variant> <out>
"""
import sys
src, var, out = sys.argv[1:4]
s = open(src).read()
def sub(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit(f'{var}: expected 1 match, got {n}: {old[:60]!r}')
    s = s.replace(old, new)

if var == 'r4settled':
    sub("""              method: SERVE_CONTROL_EXT_METHODS.sessionCd,
            }),
          ),
        );

        await expect(""", """              method: SERVE_CONTROL_EXT_METHODS.sessionCd,
            }),
          ),
        );
        hangingCd.resolve({ previousCwd: WS_A, newCwd: WS_B, warnings: [] });
        await cd;

        await expect(""")
else:
    sys.exit('unknown variant')
open(out, 'w').write(s)
print(f'{var}: wrote {out}')
