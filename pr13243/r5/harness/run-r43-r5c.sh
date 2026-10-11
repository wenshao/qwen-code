#!/bin/bash
# PR #13243 round 5, head c4f98b15c5 (h43s, TS-only change on 9aa7997816 -> head jar j43r reused).
cd /Users/wenshao/pr13243-rig
until grep -q "build exit=" out/build-h43s-build.log 2>/dev/null && grep -q "bundle exit=" out/build-h43s-bundle.log 2>/dev/null && [ -f dist/h43s/cli.js ]; do sleep 10; done
grep -q "build exit=0" out/build-h43s-build.log && grep -q "bundle exit=0" out/build-h43s-bundle.log || { echo "BUILD-FAILED"; exit 1; }
python3 inject43.py h43s h43s-inj injnew || exit 1
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
reap() { ./stop.sh none 2>/dev/null | sed -n 's/^worker-left pid=\([0-9]*\).*/\1/p' | while read p; do echo "=== reaping leftover worker pid=$p after $1"; kill $p 2>/dev/null; sleep 1; kill -9 $p 2>/dev/null; done; }
run() { local tag=$1; shift; "$@"; reap $tag; }
run r43s9i  env JAR=j43r PROXY=1 ./run-r43.sh h43s-inj r43s9i s9
run r43s1   env JAR=j43r ./run-r43.sh h43s r43s1 s1,s2,s2b,s2c,s3,s4,s5,s7,s6
run r43s2   env JAR=j43r PROXY=1 ./run-r43.sh h43s r43s2 s2d
run r43s3   env JAR=j43r PROXY=1 ./run-r43.sh h43s r43s3 s6c
run r43s4   env JAR=j43r PROXY=1 ./run-r43.sh h43s r43s4 s2e
run r43s5   env JAR=j43r ./run-r43.sh h43s r43s5 s8a
run r43s8k80 env JAR=j43r S8D_KILL_MS=80 PROXY=1 ./run-r43.sh h43s r43s8k80 s8d
echo "R5C-ALL-DONE $(date -u +%T)"
