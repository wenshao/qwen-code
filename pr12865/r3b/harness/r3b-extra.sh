#!/bin/bash
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
S='^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$'
for t in src-main src-r3b src-r3b-lease5; do
  ln -sfn $t src
  echo "== stage F on $t $(date +%T) host load $(uptime | sed 's/.*load averages: //')"
  docker run --rm --init $V pr12865-linux /rig/run-unit.sh sf-$t $MID test -Pfault-gates > /dev/null 2>&1
  echo "   $(grep -E "$S" out/sf-$t.log | tail -1)"
  grep -E '<<< FAIL' out/sf-$t.log | grep -v 'Tests run' | sed 's/.*runtimebroker\.//; s/ -- Time.*//' | sed 's/^/   fail: /'
done
ln -sfn src-r3b-candC src
echo "== cand C build+install $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/build-server.sh > out/r3bc-build.log 2>&1; echo "   build exit=$?"
echo "== cand C broker suite"; docker run --rm --init $V pr12865-linux /rig/run-unit.sh r3bc-u-full $MID test > /dev/null 2>&1; echo "   $(grep -E "$S" out/r3bc-u-full.log | tail -1)"
echo "== cand C server suite"; docker run --rm --init -e SUITE_LOG=r3bc-server $V pr12865-linux /rig/run-server-suite.sh $MID 2>&1 | tail -1
echo "== cand C probes"; docker run --rm --init $V pr12865-linux /rig/run-probe2.sh r3bc-p $MID '-Dtest=PR12865ProbeTest#p4*+p1WorkerDies*' 2>&1 | tail -1
ln -sfn src-r3b src
echo "== done $(date +%T)"
