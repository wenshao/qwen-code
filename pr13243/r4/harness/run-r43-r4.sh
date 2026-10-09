#!/bin/bash
# PR #13243 round 4 (f72edd01e6 on main 5ddd43815b). Each arm on its own jar (the head changes Java).
cd /Users/wenshao/pr13243-rig
until grep -q "BUILD-R4-DONE" out/build-r4.log 2>/dev/null; do sleep 10; done
for x in "\[h43p\] build exit=0 bundle exit=0" "\[b43m\] build exit=0 bundle exit=0"; do grep -q "$x" out/build-r4.log || { echo "BUILD-FAILED $x"; exit 1; }; done
[ -f server/j43p-server.jar ] && [ -f server/j43m-server.jar ] || { echo "JAR-MISSING"; exit 1; }
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
JAR=j43p ./run-r43.sh h43p r43p1 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
JAR=j43p PROXY=1 ./run-r43.sh h43p r43p2 s2d
JAR=j43p PROXY=1 ./run-r43.sh h43p r43p3 s6c
JAR=j43p PROXY=1 ./run-r43.sh h43p r43p4 s2e
JAR=j43p ./run-r43.sh h43p r43p5 s8a,s8d
JAR=j43m ./run-r43.sh b43m r43m1 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
JAR=j43m PROXY=1 ./run-r43.sh b43m r43m2 s2d
JAR=j43m PROXY=1 ./run-r43.sh b43m r43m3 s6c
JAR=j43m PROXY=1 ./run-r43.sh b43m r43m4 s2e
JAR=j43m ./run-r43.sh b43m r43m5 s8a,s8d
echo "R4-ALL-DONE $(date -u +%T)"
