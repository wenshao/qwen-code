#!/usr/bin/env python3
"""Apply one named production-code mutation to the PR #12250 worktree.

Every replacement must match exactly once, otherwise the script aborts, so a
mutation can never silently become a no-op.  Usage: mutate.py <root> <id>...
"""
import sys, pathlib

SCP = 'packages/acp-bridge/src/session-control-plane.ts'
BCL = 'packages/acp-bridge/src/bridgeClient.ts'

M = {
    # R1-14: drop the middle term of the drain ownership chain
    'M1_drain_middle_term': [(
        BCL,
        'const promptId = background?.turnId ?? entry?.activePromptId;',
        'const promptId = entry?.activePromptId;',
    )],
    # R1-17 rewind admission (:13942)
    'M2_rewind_admission': [(
        SCP,
        "        entry.promptActive ||\n        !!entry.backgroundTurn\n      ) {\n        throw new SessionBusyError(\n          sessionId,\n          'Cannot rewind while a prompt is running',",
        "        entry.promptActive ||\n        false\n      ) {\n        throw new SessionBusyError(\n          sessionId,\n          'Cannot rewind while a prompt is running',",
    )],
    # R1-17 branch admission (:10825)
    'M3_branch_admission': [(
        SCP,
        "          entry.promptActive ||\n          !!entry.backgroundTurn)\n      ) {\n        throw new BranchWhilePromptActiveError(sessionId);",
        "          entry.promptActive ||\n          false)\n      ) {\n        throw new BranchWhilePromptActiveError(sessionId);",
    )],
    # R1-17 branch queue callback (:10836)
    'M4_branch_callback': [(
        SCP,
        'if ((entry.promptActive || entry.backgroundTurn) && !isSideTask) {',
        'if ((entry.promptActive || false) && !isSideTask) {',
    )],
    # R1-17 fork admission (:13663)
    'M6_fork_admission': [(
        SCP,
        "        entry.promptActive ||\n        !!entry.backgroundTurn\n      ) {\n        throw new SessionBusyError(\n          sessionId,\n          'Cannot fork while a response or tool call is in progress',",
        "        entry.promptActive ||\n        false\n      ) {\n        throw new SessionBusyError(\n          sessionId,\n          'Cannot fork while a response or tool call is in progress',",
    )],
    # R1-17 fork queue callback (:13674)
    'M7_fork_callback': [(
        SCP,
        "          entry.promptActive ||\n          !!entry.backgroundTurn\n        ) {\n          throw new SessionBusyError(\n            sessionId,\n            'Cannot fork while a response or tool call is in progress',",
        "          entry.promptActive ||\n          false\n        ) {\n          throw new SessionBusyError(\n            sessionId,\n            'Cannot fork while a response or tool call is in progress',",
    )],
    # R1-17 cd guard inside the queue continuation (:11182)
    'M9_cd_guard': [(
        SCP,
        'if (entry.promptActive || entry.backgroundTurn) {\n            throw new CdWhilePromptActiveError(sessionId);',
        'if (entry.promptActive || false) {\n            throw new CdWhilePromptActiveError(sessionId);',
    )],
    # R1-16/R1-17 reaper retention term (:2684)
    'M10_entryHasLocalWork': [(
        SCP,
        '      entry.pendingAgentNotificationCount > 0 ||\n      !!entry.backgroundTurn\n    );',
        '      entry.pendingAgentNotificationCount > 0 ||\n      false\n    );',
    )],
    # side-task concurrent-release decision (:10816) -- PR says NOT pinned
    'M11_sidetask_release': [(
        SCP,
        'isSideTask && (entry.promptActive || !!entry.backgroundTurn);',
        'isSideTask && (entry.promptActive || false);',
    )],
}
# R1-14 at the drain call site only: currentTurnMetadata stays intact for
# every other caller, the drain falls straight to activePromptId
M['M1b_drain_site_only'] = [(
    BCL,
    'const promptId = requestedPromptId ?? currentTurnMetadata(entry).promptId;',
    'const promptId = requestedPromptId ?? entry.activePromptId;',
)]
M['M5_branch_both'] = M['M3_branch_admission'] + M['M4_branch_callback']
M['M8_fork_both'] = M['M6_fork_admission'] + M['M7_fork_callback']


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
        print('\n'.join(M))
        sys.exit(0)
    for mid in sys.argv[2:]:
        apply(sys.argv[1], mid)
