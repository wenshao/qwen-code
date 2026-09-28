#!/bin/bash
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
echo "== cand probes+gates tini $(date +%T)"
docker run --rm --init -e CAND=1 -e CANDDIR=cand-r2 $V pr12865-linux /rig/run-probe3.sh r2-cand $MID '-Dtest=PR12865ProbeTest#p1WorkerDies*+p1bWorker*+z2*+t1*,DurableLocalRuntimeFaultGateTest' 2>&1 | tail -2
echo "== cand non-reaping $(date +%T)"
CID=$(docker run -d -e CAND=1 -e CANDDIR=cand-r2 $V pr12865-linux sleep infinity)
docker exec -e CAND=1 -e CANDDIR=cand-r2 $CID /rig/run-probe3.sh r2-cand-zombie $MID '-Dtest=PR12865ProbeTest#c1*+z2*' 2>&1 | tail -2
docker rm -f $CID >/dev/null
echo "== done $(date +%T)"
