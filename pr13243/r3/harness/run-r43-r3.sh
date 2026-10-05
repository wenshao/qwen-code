#!/bin/bash
# PR #13243 round 3 (be10a118a1 on main 6136786c0c): head and new-base arms on the new jar.
cd /Users/wenshao/pr13129-rig
until grep -q "BUILD-R3-DONE" out/r43/build-r3.log 2>/dev/null; do sleep 10; done
grep -q "\[h43h\] build exit=0 bundle exit=0" out/r43/build-r3.log && grep -q "\[b43n\] build exit=0 bundle exit=0" out/r43/build-r3.log && grep -q "\[j43n\] server package exit=0" out/r43/build-r3.log || { echo "BUILD-FAILED"; exit 1; }
export JAR=j43n SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
./run-r43.sh h43h r43h3 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
PROXY=1 ./run-r43.sh h43h r43h4 s2d
PROXY=1 ./run-r43.sh h43h r43h5 s6c
./run-r43.sh b43n r43n s1,s2,s2b,s2c,s3,s4,s5,s7,s6
PROXY=1 ./run-r43.sh b43n r43n2 s2d
PROXY=1 ./run-r43.sh b43n r43n3 s6c
echo "R3-ALL-DONE $(date -u +%T)"
