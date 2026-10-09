#!/bin/bash
# Round 4b: S8d parked case + recovery attempts on head 93129b and base.
cd /Users/wenshao/pr13243-rig
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
JAR=j43p S8D_KILL_MS=80 PROXY=1 ./run-r43.sh h43q r43q8r80 s8d
JAR=j43p S8D_KILL_MS=150 PROXY=1 ./run-r43.sh h43q r43q8r150 s8d
JAR=j43m S8D_KILL_MS=80 PROXY=1 ./run-r43.sh b43m r43m8r80 s8d
JAR=j43p S8D_KILL_MS=80 PROXY=1 ./run-r43.sh h43p r43p8r80 s8d
echo "R4D-ALL-DONE $(date -u +%T)"
