#!/bin/bash
# PR #13243 round 5: head 9aa7997816 (h43r, jar j43r) vs merge-base d9c6f8c0fe (b43r, jar j43rb).
# S9 = bot R4-3 consequence chain with the Windows sync throw injected at the import site (inject43.py).
cd /Users/wenshao/pr13243-rig
until grep -q "BUILD-R5-DONE" out/build43-r5.log 2>/dev/null; do sleep 10; done
for x in "\[h43r\] build exit=0 bundle exit=0" "\[b43r\] build exit=0 bundle exit=0"; do grep -q "$x" out/build43-r5.log || { echo "BUILD-FAILED $x"; exit 1; }; done
[ -f server/j43r-server.jar ] && [ -f server/j43rb-server.jar ] || { echo "JAR-MISSING"; exit 1; }
python3 inject43.py h43r h43r-inj inj || exit 1
python3 inject43.py h43r h43r-injfix injfix || exit 1
python3 inject43.py b43r b43r-inj base || exit 1
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
reap() { # leftover workers of this rig's dists, by PID
  ./stop.sh none 2>/dev/null | sed -n 's/^worker-left pid=\([0-9]*\).*/\1/p' | while read p; do echo "=== reaping leftover worker pid=$p after $1"; kill $p 2>/dev/null; sleep 1; kill -9 $p 2>/dev/null; done
}
run() { local tag=$1; shift; "$@"; reap $tag; }
run r43r9i  env JAR=j43r  PROXY=1 ./run-r43.sh h43r-inj    r43r9i s9
run r43r9f  env JAR=j43r  PROXY=1 ./run-r43.sh h43r-injfix r43r9f s9
run r43b9i  env JAR=j43rb PROXY=1 ./run-r43.sh b43r-inj    r43b9i s9
run r43r1   env JAR=j43r  ./run-r43.sh h43r r43r1 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
run r43r2   env JAR=j43r  PROXY=1 ./run-r43.sh h43r r43r2 s2d
run r43r3   env JAR=j43r  PROXY=1 ./run-r43.sh h43r r43r3 s6c
run r43r4   env JAR=j43r  PROXY=1 ./run-r43.sh h43r r43r4 s2e
run r43r5   env JAR=j43r  ./run-r43.sh h43r r43r5 s8a
run r43r8k80  env JAR=j43r S8D_KILL_MS=80  PROXY=1 ./run-r43.sh h43r r43r8k80 s8d
run r43r8k150 env JAR=j43r S8D_KILL_MS=150 PROXY=1 ./run-r43.sh h43r r43r8k150 s8d
run r43b1   env JAR=j43rb ./run-r43.sh b43r r43b1 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
run r43b2   env JAR=j43rb PROXY=1 ./run-r43.sh b43r r43b2 s2d
run r43b3   env JAR=j43rb PROXY=1 ./run-r43.sh b43r r43b3 s6c
run r43b4   env JAR=j43rb PROXY=1 ./run-r43.sh b43r r43b4 s2e
run r43b5   env JAR=j43rb ./run-r43.sh b43r r43b5 s8a
run r43b8k80 env JAR=j43rb S8D_KILL_MS=80 PROXY=1 ./run-r43.sh b43r r43b8k80 s8d
echo "R5-ALL-DONE $(date -u +%T)"
