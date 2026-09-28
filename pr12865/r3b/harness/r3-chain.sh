#!/bin/bash
# usage: r3-chain.sh <prefix>   (rig src symlink must already point at the tree under test)
P=$1
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
echo "== $P tree $(readlink src) build+install $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/build-server.sh > out/$P-build.log 2>&1; echo "build exit=$?"
cp server/qwen-managed-agent-server-0.1.0-alpha.jar server/$P.jar 2>/dev/null
echo "== $P broker suite $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/run-unit.sh $P-u-full $MID test 2>&1 | tail -2
echo "== $P stage F $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/run-unit.sh $P-g-stagef $MID test -Pfault-gates 2>&1 | tail -2
echo "== $P server suite $(date +%T)"; docker run --rm --init -e SUITE_LOG=$P-server $V pr12865-linux /rig/run-server-suite.sh $MID 2>&1 | tail -2
echo "== $P probes tini $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/run-probe2.sh $P-p-init $MID '-Dtest=PR12865ProbeTest#p1WorkerDies*+p1bWorker*+p3Misconfigured*+p3b*+c1*+t1*+z2*+p4*' 2>&1 | tail -2
echo "== $P probes non-reaping $(date +%T)"; CID=$(docker run -d $V pr12865-linux sleep infinity); docker exec $CID /rig/run-probe2.sh $P-p-zombie $MID '-Dtest=PR12865ProbeTest#c1*+z2*' 2>&1 | tail -2; docker rm -f $CID >/dev/null
echo "== $P done $(date +%T)"
