#!/usr/bin/env python3
"""Apply one arm to the head worktree's TrajectoryPanel sources (from backup),
or restore. usage: arms.py <M0|M1|M2|FIX|restore>"""
import shutil, sys

H = '/root/verify/pr12434-head/packages/web-shell/client/components/artifacts'
BK = '/root/verify/pr12434-backup-head'
arm = sys.argv[1]

shutil.copy(f'{BK}/TrajectoryPanel.tsx', f'{H}/TrajectoryPanel.tsx')
shutil.copy(f'{BK}/TrajectoryPanel.module.css', f'{H}/TrajectoryPanel.module.css')
if arm in ('restore', 'M0'):
    sys.exit(0)

tsx = open(f'{H}/TrajectoryPanel.tsx').read()
css = open(f'{H}/TrajectoryPanel.module.css').read()
CORR = 'scrollTo(element, element.scrollTop + delta * ROW_HEIGHT);'
assert CORR in tsx
if arm == 'M1':  # drop the prepend correction
    tsx = tsx.replace(CORR, 'void delta;')
elif arm == 'M2':  # apply it twice
    tsx = tsx.replace(CORR, 'scrollTo(element, element.scrollTop + 2 * delta * ROW_HEIGHT);')
elif arm == 'FIX':  # suggested patch: fixed bar height + keep focus while loading
    assert 'min-height: 31px;' in css
    css = css.replace('min-height: 31px;', 'height: 35px;')
    DIS = "disabled={loadingOlder || status === 'loading'}"
    assert DIS in tsx
    tsx = tsx.replace(DIS, "disabled={status === 'loading'}\n                    aria-disabled={loadingOlder || undefined}")
else:
    raise SystemExit(f'unknown arm {arm}')
open(f'{H}/TrajectoryPanel.tsx', 'w').write(tsx)
open(f'{H}/TrajectoryPanel.module.css', 'w').write(css)
