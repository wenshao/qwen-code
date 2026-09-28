#!/bin/bash
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
V="-v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository"
ln -sfn src-r3-head src
echo "== head stage F rerun $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/run-unit.sh r3h-g-stagef-2 $MID test -Pfault-gates 2>&1 | tail -1
grep -E "^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" out/r3h-g-stagef-2.log | tail -1
ln -sfn src-r3-cand src
echo "== cand build+install $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/build-server.sh > out/r3c-build.log 2>&1; echo "build exit=$?"
echo "== cand broker suite $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/run-unit.sh r3c-u-full $MID test 2>&1 | tail -1
echo "== cand server suite $(date +%T)"; docker run --rm --init -e SUITE_LOG=r3c-server $V pr12865-linux /rig/run-server-suite.sh $MID 2>&1 | tail -1
echo "== cand probes $(date +%T)"; docker run --rm --init $V pr12865-linux /rig/run-probe2.sh r3c-p-init $MID '-Dtest=PR12865ProbeTest#p4*+p1WorkerDies*,DurableLocalRuntimeFaultGateTest' 2>&1 | tail -1
ln -sfn src-r3-head src
echo "== done $(date +%T)"
