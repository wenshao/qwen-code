#!/usr/bin/env python3
"""R3 mutants for PR #12250: the R1+R2 set plus two for the open bot threads.
Every replacement must match exactly once.  Writes go through a temp file +
os.replace so a hardlinked worktree copy never writes through to its source.
Usage: mutate3.py <root> <id>...   |   mutate3.py <root> --list
"""
import sys, os, pathlib, importlib.util
spec = importlib.util.spec_from_file_location('m2', str(pathlib.Path(__file__).with_name('mutate2.py')))
m2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(m2)
M = dict(m2.M)
SCP = 'packages/acp-bridge/src/session-control-plane.ts'

# R5-2: relocate rewind's background-turn term from the admission check into
# its queue callback (callback has no backgroundTurn check today)
M['M16_rewind_relocated'] = M['M2_rewind_admission'] + [(
    SCP,
    "      const rewindResult = entry.promptQueue.then(async () => {\n        if (entry.closing) {\n          throw new SessionNotFoundError(sessionId, 'The session is closing');\n        }\n",
    "      const rewindResult = entry.promptQueue.then(async () => {\n        if (entry.closing) {\n          throw new SessionNotFoundError(sessionId, 'The session is closing');\n        }\n        if (entry.backgroundTurn) {\n          throw new SessionBusyError(\n            sessionId,\n            'Cannot rewind while a prompt is running',\n          );\n        }\n",
)]
# R6-1: the summary projection stops counting the background turn, while
# retention (entryHasLocalWork) stays intact
M['M17_projection_drops_turn'] = [(
    SCP,
    "    if (entryHasLocalWork(entry) || childReportsHeldWork(entry)) {\n      return 'active';\n    }\n    const capability = channelInfoForEntry(entry)?.harness.activeWork;",
    "    if (\n      entry.pendingPromptCount > 0 ||\n      entry.pendingAgentNotificationCount > 0 ||\n      childReportsHeldWork(entry)\n    ) {\n      return 'active';\n    }\n    const capability = channelInfoForEntry(entry)?.harness.activeWork;",
)]

def apply(root, mid):
    for rel, old, new in M[mid]:
        p = pathlib.Path(root) / rel
        s = p.read_text()
        n = s.count(old)
        if n != 1:
            sys.exit(f'{mid}: expected exactly 1 match in {rel}, got {n}')
        tmp = p.with_suffix(p.suffix + '.mut-tmp')
        tmp.write_text(s.replace(old, new)); os.replace(tmp, p)
        print(f'{mid}: patched {rel}')

if __name__ == '__main__':
    if sys.argv[2] == '--list':
        print('\n'.join(M)); sys.exit(0)
    for mid in sys.argv[2:]:
        apply(sys.argv[1], mid)
