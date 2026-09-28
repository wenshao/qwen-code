#!/bin/bash
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
D="docker run --rm --init -v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository pr12865-linux"
echo "== build+install $(date +%T)"; $D /rig/build-server.sh > out/r2-build.log 2>&1; echo "build exit=$?"
echo "== broker suite $(date +%T)"; $D /rig/run-unit.sh r2-u-full $MID test 2>&1 | tail -3
echo "== stage F $(date +%T)"; $D /rig/run-unit.sh r2-g-stagef $MID test -Pfault-gates 2>&1 | tail -3
echo "== server suite $(date +%T)"; $D /rig/run-server-suite.sh $MID 2>&1 | tail -2
echo "== probes tini $(date +%T)"; $D /rig/run-probe2.sh r2-p-init $MID '-Dtest=PR12865ProbeTest#p1WorkerDies*+p1bWorker*+p3b*+c1*+t1*+z2*' 2>&1 | tail -2
echo "== probes non-reaping $(date +%T)"; CID=$(docker run -d -v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository pr12865-linux sleep infinity); docker exec $CID /rig/run-probe2.sh r2-p-zombie $MID '-Dtest=PR12865ProbeTest#c1*+z2*' 2>&1 | tail -2; docker rm -f $CID >/dev/null
echo "== done $(date +%T)"
