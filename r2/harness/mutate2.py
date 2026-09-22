#!/usr/bin/env python3
"""R2 mutants for PR #12250: the R1 set (mutate.py) plus two that target the
retention test's new positive control.  Every replacement must match exactly
once, so a mutation can never silently become a no-op.
Usage: mutate2.py <root> <id>...   |   mutate2.py <root> --list
"""
import sys, pathlib, importlib.util
spec = importlib.util.spec_from_file_location('m1', str(pathlib.Path(__file__).with_name('mutate.py')))
m1 = importlib.util.module_from_spec(spec); spec.loader.exec_module(m1)
M = dict(m1.M)
BCL = m1.BCL
# end_turn no longer clears the admitted background turn
M['M12_end_turn_keeps_turn'] = [(
    BCL,
    '    const backgroundTurn = entry.backgroundTurn;\n    delete entry.backgroundTurn;\n',
    '    const backgroundTurn = entry.backgroundTurn;\n',
)]
# end_turn clears the turn but no longer fires the settle hook
M['M13_end_turn_no_settle_hook'] = [(
    BCL,
    '    this.onAutomaticTurnEnded?.(sessionId);\n  }\n\n  /**\n   * Handle child->bridge ACP `extMethod`',
    '  }\n\n  /**\n   * Handle child->bridge ACP `extMethod`',
)]

# a plausible future change: treat an unknown child report as a reason to
# retain (entryIsAutoCloseCandidate deliberately does not, today)
M['M14_unknown_retains'] = [(
    m1.SCP,
    '    if (entry.events.subscriberCount > 0) return false;\n    if (entryHasLocalWork(entry)) return false;\n',
    '    if (entry.events.subscriberCount > 0) return false;\n    if (entryHasLocalWork(entry)) return false;\n    if (childWorkIsUnknown(entry)) return false;\n',
)]

def apply(root, mid):
    for rel, old, new in M[mid]:
        p = pathlib.Path(root) / rel
        s = p.read_text()
        n = s.count(old)
        if n != 1:
            sys.exit(f'{mid}: expected exactly 1 match in {rel}, got {n}')
        p.write_text(s.replace(old, new))
        print(f'{mid}: patched {rel}')

if __name__ == '__main__':
    if sys.argv[2] == '--list':
        print('\n'.join(M)); sys.exit(0)
    for mid in sys.argv[2:]:
        apply(sys.argv[1], mid)
