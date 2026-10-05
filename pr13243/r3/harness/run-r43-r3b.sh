#!/bin/bash
# PR #13243 round 3: S2e recovery probe on head be10 and the new base, after the main chain.
cd /Users/wenshao/pr13129-rig
until grep -q "R3-ALL-DONE" out/r43/run-r3.txt 2>/dev/null; do sleep 10; done
export JAR=j43n SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
PROXY=1 ./run-r43.sh h43h r43h6 s2e
PROXY=1 ./run-r43.sh b43n r43n4 s2e
echo "R3B-ALL-DONE $(date -u +%T)"
