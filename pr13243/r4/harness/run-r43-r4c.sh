#!/bin/bash
# PR #13243 round 4b: head 93129b50c6 (R8-1 narrowing; TS only, jar j43p reused). G1/F1/O1 paths + S8 sweep.
cd /Users/wenshao/pr13243-rig
./build-ts.sh wt43 h43q
grep -q "build exit=0" out/build-h43q-build.log && grep -q "bundle exit=0" out/build-h43q-bundle.log || { echo "BUILD-FAILED"; exit 1; }
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
JAR=j43p ./run-r43.sh h43q r43q1 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
JAR=j43p PROXY=1 ./run-r43.sh h43q r43q2 s2d
JAR=j43p PROXY=1 ./run-r43.sh h43q r43q4 s2e
JAR=j43p ./run-r43.sh h43q r43q5 s8a
for d in 80 150 250; do JAR=j43p S8D_KILL_MS=$d PROXY=1 ./run-r43.sh h43q r43q8k$d s8d; done
echo "R4C-ALL-DONE $(date -u +%T)"
