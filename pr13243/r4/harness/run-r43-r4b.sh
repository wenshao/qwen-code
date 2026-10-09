#!/bin/bash
# PR #13243 round 4: S8d kill-delay sweep on the head (try to park a turn behind a cancelled PreToolUse receipt with a real duration).
cd /Users/wenshao/pr13243-rig
until grep -q "R4-ALL-DONE" out/run-r4.txt 2>/dev/null; do sleep 10; done
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
for d in 80 150 250 400; do
  JAR=j43p S8D_KILL_MS=$d PROXY=1 ./run-r43.sh h43p r43p8k$d s8d
done
echo "R4B-ALL-DONE $(date -u +%T)"
