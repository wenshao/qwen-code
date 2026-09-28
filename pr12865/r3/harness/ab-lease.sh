#!/bin/bash
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
T='DurableLocalRuntimeFaultGateTest#adoptedWorkerCanCancelItsOriginalActiveCall'
for i in 1 2 3; do
  for tree in src-r3-head src-r3-lease10; do
    L=lease-$tree-$i
    docker run --rm --init $V pr12865-linux bash -c "printf '%s\n' $MID > /etc/machine-id; rm -rf /work; mkdir -p /work; cp -a /rig/$tree/. /work/; cd /work/packages/sdk-java/runtime-broker; mvn -o -B -ntp -q test-compile > /dev/null 2>&1; mvn -o -B -ntp surefire:test -Pfault-gates -Dtest='$T' -Dsurefire.failIfNoSpecifiedTests=false > /rig/out/$L.log 2>&1"
    echo "$tree run $i: $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' out/$L.log | tail -1) | host load $(uptime | sed 's/.*load averages: //')"
  done
done
