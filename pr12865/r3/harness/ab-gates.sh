#!/bin/bash
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
for i in 1 2 3; do
  for tree in src-r2 src-r3-head; do
    L=ab-$tree-$i
    hostload=$(uptime | sed 's/.*load averages: //')
    docker run --rm --init $V pr12865-linux bash -c "printf '%s\n' $MID > /etc/machine-id; rm -rf /work; mkdir -p /work; cp -a /rig/$tree/. /work/; cd /work/packages/sdk-java/runtime-broker; mvn -o -B -ntp -q test-compile > /dev/null 2>&1; l0=\$(cut -d' ' -f1-3 /proc/loadavg); mvn -o -B -ntp surefire:test -Pfault-gates -Dtest=DurableLocalRuntimeFaultGateTest -Dsurefire.failIfNoSpecifiedTests=false > /rig/out/$L.log 2>&1; r=\$(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+\$' /rig/out/$L.log | tail -1); f=\$(grep -oE 'FaultGateTest\.[a-zA-Z]+(\(Placement\))?\[[0-9]\] -- Time elapsed: [0-9.]+ s <<< FAIL' /rig/out/$L.log | sed -E 's/FaultGateTest\.//; s/\(Placement\)//; s/ -- Time elapsed.*//' | tr '\n' ' '); echo \"$tree run $i | vm load before \$l0 | $r | failed: \$f\""
    echo "   (host load at start: $hostload)"
  done
done
