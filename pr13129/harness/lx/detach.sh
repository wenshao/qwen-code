#!/bin/sh
# VERIFICATION RIG ONLY: leaves a detached descendant (new session, reparented) and exits at once.
setsid sh -c 'echo $$ > /lx/cmd/detached.pid; exec sleep 300' </dev/null >/dev/null 2>&1 &
echo "{\"t\":$(date +%s%N),\"hook\":\"detach\",\"pid\":$$,\"cgroup\":\"$(cat /proc/self/cgroup | tr -d '\n')\"}" >> /lx/cmd/ledger.jsonl
printf '%s' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"DETACH-CTX"}}'
