#!/bin/bash
R=/Users/wenshao/pr12964-rig
D="docker run --rm --init --memory=1500m -v $R:/rig -v $R/m2:/root/.m2/repository pr12865-linux"
echo "== $(date +%T) load $(uptime | sed 's/.*averages: //')"
$D /rig/run-gates.sh src-cand cand-gates 1 '*FaultGate*' 2>&1 | tail -12
echo "== $(date +%T) load $(uptime | sed 's/.*averages: //')"
$D /rig/run-gates.sh src-cand cand-durable 3 'DurableLocalRuntimeFaultGateTest' 2>&1 | tail -12
echo "== $(date +%T)"
$D /rig/run-gates.sh src-merge merge-durable-b 2 'DurableLocalRuntimeFaultGateTest' 2>&1 | tail -12
echo "== $(date +%T)"
$D /rig/run-unit.sh src-merge merge-broker-unit runtime-broker test checkstyle:check 2>&1 | tail -6
echo "== $(date +%T)"
$D /rig/run-unit.sh src-merge merge-server managed-agent-server test 2>&1 | tail -6
echo "== $(date +%T) done"
