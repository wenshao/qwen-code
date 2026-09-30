#!/bin/sh
# VERIFICATION RIG ONLY: PreToolUse command Hook. Records pid/ppid/cgroup/env, denies *blocked* paths.
IN=$(cat)
echo "{\"t\":$(date +%s%N),\"hook\":\"pre\",\"pid\":$$,\"cgroup\":\"$(cat /proc/self/cgroup | tr -d '\n')\",\"secretEnv\":\"${RIG_SECRET:-}\",\"home\":\"$HOME\"}" >> /lx/cmd/ledger.jsonl
case "$IN" in
  *blocked*) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"CMD-DENY"}}' ;;
  *) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"CMD-CTX"}}' ;;
esac
