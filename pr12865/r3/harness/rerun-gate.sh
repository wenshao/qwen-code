#!/bin/bash
# usage: rerun-gate.sh <tree-dir> <label> <n> <test>   (runs inside docker, sequential n times)
TREE=$1; LABEL=$2; N=$3; TEST=$4
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
docker run --rm --init $V pr12865-linux bash -c "printf '%s\n' $MID > /etc/machine-id; rm -rf /work; mkdir -p /work; cp -a /rig/$TREE/. /work/; cd /work/packages/sdk-java/runtime-broker; mvn -o -B -ntp -q test-compile > /dev/null 2>&1; for i in \$(seq 1 $N); do mvn -o -B -ntp surefire:test -Pfault-gates -Dtest='$TEST' -Dsurefire.failIfNoSpecifiedTests=false > /tmp/r.log 2>&1; r=\$(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+\$' /tmp/r.log | tail -1); c=\$(grep -oE 'Broker call failed: [0-9]+ [a-z_]+' /tmp/r.log | head -1); echo \"$LABEL run \$i: \$r \$c\"; cp /tmp/r.log /rig/out/$LABEL-\$i.log; done"
