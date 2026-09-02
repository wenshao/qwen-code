#!/usr/bin/env python3
"""Apply one named mutant to the PR #10802 head worktree."""
import sys, os

WT = os.environ['WT']
name = sys.argv[1]

CLI = os.path.join(WT, 'packages/cli/src')
CORE = os.path.join(WT, 'packages/core/src')

def edit(path, old, new, count=1):
    with open(path) as f:
        s = f.read()
    n = s.count(old)
    if n != count:
        raise SystemExit(f'FATAL: expected {count} occurrence(s) of pattern in {path}, found {n}')
    s = s.replace(old, new)
    with open(path, 'w') as f:
        f.write(s)
    print(f'applied {name} -> {path}')

STREAM = os.path.join(CLI, 'ui/hooks/use-llm-stream.ts')
GOALCMD = os.path.join(CLI, 'ui/commands/goalCommand.ts')
SESSION = os.path.join(CLI, 'acp-integration/session/Session.ts')
NONINT = os.path.join(CLI, 'nonInteractiveCli.ts')
REDUCER = os.path.join(CORE, 'goals/goal-reducer.ts')
PROTO = os.path.join(CORE, 'goals/goal-protocol.ts')

if name == 'M1':
    # Delete the whole new partial-cancel branch.
    with open(STREAM) as f:
        s = f.read()
    start = s.index('      // A Goal tool batch the user cancelled stops the Goal, even when some')
    end = s.index('      const callIdsToMarkAsSubmitted = llmTools.map(', start)
    block = s[start:end]
    assert 'someToolsCancelled' in block
    s = s[:start] + s[end:]
    with open(STREAM, 'w') as f:
        f.write(s)
    print(f'applied M1: removed {len(block)} chars from {STREAM}')

elif name == 'M2':
    # Drop the history pairing inside the new branch.
    edit(STREAM,
         "        llmClient?.addHistory({ role: 'user', parts: responsesToSend });\n"
         "        markToolsAsSubmitted(\n"
         "          llmTools.map((toolCall) => toolCall.request.callId),\n"
         "        );\n"
         "        await failClosedGoalTurn(\n"
         "          toolGoalBinding,\n"
         "          'Goal tool batch was cancelled',",
         "        markToolsAsSubmitted(\n"
         "          llmTools.map((toolCall) => toolCall.request.callId),\n"
         "        );\n"
         "        await failClosedGoalTurn(\n"
         "          toolGoalBinding,\n"
         "          'Goal tool batch was cancelled',")

elif name == 'M3':
    # Drop the turnCancelledRef guard: pause on any partial cancellation.
    edit(STREAM,
         'if (toolGoalBinding && someToolsCancelled && turnCancelledRef.current) {',
         'if (toolGoalBinding && someToolsCancelled) {')

elif name == 'M4':
    # failClosedGoalTurn always reports a failure reason, never the user interrupt.
    edit(STREAM,
         "              reason: options?.userCancelled\n"
         "                ? GOAL_PAUSE_REASON_USER_INTERRUPT\n"
         "                : goalPauseReasonForFailure(reason),",
         "              reason: goalPauseReasonForFailure(reason),")

elif name == 'M5':
    # Reducer keeps the stale reason instead of writing the supplied one.
    edit(REDUCER,
         "    return transitionGoal(current, transition.now, {\n"
         "      status: 'paused',\n"
         "      lastReason: request.reason,\n"
         "    });",
         "    return transitionGoal(current, transition.now, {\n"
         "      status: 'paused',\n"
         "    });")

elif name == 'M6':
    # Reducer records the reason but never clears a stale one.
    edit(REDUCER,
         "      lastReason: request.reason,",
         "      lastReason: request.reason ?? current.lastReason,")

elif name == 'M7':
    # Parser stops validating the reason (accepts empty / oversized / non-string).
    edit(REDUCER,
         "      const reason = value['reason'];\n"
         "      if (reason !== undefined) {\n"
         "        if (typeof reason !== 'string' || validateGoalPauseReason(reason)) {\n"
         "          return undefined;\n"
         "        }\n"
         "      }",
         "      const reason = value['reason'];")

elif name == 'M8':
    # Parser drops the length bound only.
    edit(PROTO,
         "  if ([...reason].length > GOAL_PAUSE_REASON_MAX_CHARACTERS) {\n"
         "    return `Goal pause reason exceeds ${GOAL_PAUSE_REASON_MAX_CHARACTERS} characters`;\n"
         "  }\n",
         "")

elif name == 'M9':
    # `resume`/`clear` also accept a reason key (the "pause only" rule is gone).
    edit(REDUCER,
         "        !hasOnlyKeys(value, ['action', 'expectedGoalId', 'expectedRevision']) ||\n"
         "        !isExpectedVersion(value)\n"
         "      ) {\n"
         "        return undefined;\n"
         "      }\n"
         "      return {\n"
         "        action: value['action'],",
         "        !hasOnlyKeys(value, [\n"
         "          'action',\n"
         "          'expectedGoalId',\n"
         "          'expectedRevision',\n"
         "          'reason',\n"
         "        ]) ||\n"
         "        !isExpectedVersion(value)\n"
         "      ) {\n"
         "        return undefined;\n"
         "      }\n"
         "      return {\n"
         "        action: value['action'],")

elif name == 'M10':
    # /goal pause stops naming itself.
    edit(GOALCMD,
         "          : operation.kind === 'pause'\n"
         "            ? {\n"
         "                action: 'pause',\n"
         "                ...version,\n"
         "                reason: GOAL_PAUSE_REASON_COMMAND,\n"
         "              }\n"
         "            : { action: operation.kind, ...version };",
         "          : { action: operation.kind, ...version };")

elif name == 'M11':
    # ACP: every non-user pause collapses to the same generic failure reason.
    edit(SESSION,
         "            reason: cancelledByUser\n"
         "              ? GOAL_PAUSE_REASON_USER_INTERRUPT\n"
         "              : result?.stopReason === 'max_tokens'\n"
         "                ? GOAL_PAUSE_REASON_MODEL_OUTPUT_LIMIT\n"
         "                : turn.controller.signal.reason === SESSION_DISPOSE_ABORT_REASON\n"
         "                  ? GOAL_PAUSE_REASON_SESSION_DISPOSED\n"
         "                  : goalPauseReasonForFailure('the turn failed'),",
         "            reason: cancelledByUser\n"
         "              ? GOAL_PAUSE_REASON_USER_INTERRUPT\n"
         "              : goalPauseReasonForFailure('the turn failed'),")

elif name == 'M12':
    # Headless: the run-budget pause loses the budget that tripped.
    edit(NONINT,
         "        exceeded\n"
         "          ? goalPauseReasonForRunBudget(exceeded.kind)\n"
         "          : GOAL_PAUSE_REASON_USER_INTERRUPT,",
         "        GOAL_PAUSE_REASON_USER_INTERRUPT,")

elif name == 'M13':
    # Reason builders stop truncating at the bound.
    edit(PROTO,
         "function truncateGoalPauseReason(reason: string): string {\n"
         "  const codePoints = [...reason];\n"
         "  return codePoints.length <= GOAL_PAUSE_REASON_MAX_CHARACTERS\n"
         "    ? reason\n"
         "    : `${codePoints.slice(0, GOAL_PAUSE_REASON_MAX_CHARACTERS - 1).join('')}\\u2026`;\n"
         "}",
         "function truncateGoalPauseReason(reason: string): string {\n"
         "  return reason;\n"
         "}")

elif name == 'M14':
    # ACP Stop-hook cap pause stops naming itself.
    edit(SESSION,
         "        action: 'pause',\n"
         "        expectedGoalId: goal.goalId,\n"
         "        expectedRevision: goal.revision,\n"
         "        reason: GOAL_PAUSE_REASON_STOP_HOOK_CAP,",
         "        action: 'pause',\n"
         "        expectedGoalId: goal.goalId,\n"
         "        expectedRevision: goal.revision,")

else:
    raise SystemExit(f'unknown mutant {name}')
