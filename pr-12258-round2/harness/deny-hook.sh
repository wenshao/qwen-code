#!/bin/bash
cat >> /root/verify/pr12258-r2/hooklogs/deny-hook-input.jsonl; echo >> /root/verify/pr12258-r2/hooklogs/deny-hook-input.jsonl
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by policy hook"}}'
exit 0
