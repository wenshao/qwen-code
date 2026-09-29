#!/bin/bash
R=/Users/wenshao/pr12964-rig
V="-v $R:/rig -v $R/m2:/root/.m2/repository"
D="docker run --rm --init --memory=1500m $V pr12865-linux"
DN="docker run --rm --init --memory=1500m --network pr12964net $V pr12865-linux"
DM="docker run --rm --init --memory=1500m --network container:pr12964-db $V"
echo "== $(date +%T) load $(uptime | sed 's/.*averages: //') outage gate A/B (H2)"
for i in 1 2 3; do
  $D /rig/run-gates.sh src-main main-outage-$i 1 'ConcurrencyStorageFaultGateTest#aDatabaseOutage*' 2>&1 | grep "run 1"
  $D /rig/run-gates.sh src-merge merge-outage-$i 1 'ConcurrencyStorageFaultGateTest#aDatabaseOutage*' 2>&1 | grep "run 1"
done
echo "== $(date +%T) shared ledger contract on MySQL 8.4 / MariaDB 10.11"
$DN /rig/run-it.sh src-merge it-broker-mysql84 runtime-broker pr12964-db rb_it_mysql rootpw 2>&1 | tail -6
$DN /rig/run-it.sh src-merge it-broker-maria runtime-broker pr12964-maria rb_it_maria rootpw 2>&1 | tail -6
$DN /rig/run-it.sh src-merge it-server-mysql84 managed-agent-server pr12964-db ma_it_mysql rootpw 2>&1 | tail -6
$DN /rig/run-it.sh src-merge it-server-maria managed-agent-server pr12964-maria ma_it_maria rootpw 2>&1 | tail -6
echo "== $(date +%T) G2 probe on MySQL 8.4 (merge vs main)"
$DM -e EXTRA="-Dg2.arm=merge -Dg2.out=/rig/out/g2probe.jsonl" pr12865-linux /rig/run-gates-mysql2.sh src-mysql probe-merge 1 'G2ProbeFaultGateTest' 2>&1 | tail -6
$DM -e EXTRA="-Dg2.arm=main -Dg2.out=/rig/out/g2probe.jsonl" pr12865-linux /rig/run-gates-mysql2.sh src-main-mysql probe-main 1 'G2ProbeFaultGateTest' 2>&1 | tail -6
echo "== $(date +%T) all fault gates on MySQL 8.4 (merge + candidate)"
$DM pr12865-linux /rig/run-gates-mysql2.sh src-mysql gates-mysql 1 '*FaultGateTest' 2>&1 | tail -10
echo "== $(date +%T) durable gate on MySQL 8.4 without candidate (merge)"
cp -Rc $R/src-mysql $R/src-mysql-nocand 2>/dev/null; cp $R/src-merge/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/DurableLocalRuntimeFaultGateTest.java $R/src-mysql-nocand/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
$DM pr12865-linux /rig/run-gates-mysql2.sh src-mysql-nocand durable-mysql-nocand 1 'DurableLocalRuntimeFaultGateTest' 2>&1 | tail -6
echo "== $(date +%T) done"
