#!/bin/bash
# Round 2: main d5a157c45e and main + PR (tree 373ff6b3), bundle built from the round-2 merge tree.
R=/Users/wenshao/pr12964-rig
V="-v $R:/rig -v $R/m2:/root/.m2/repository"
D="docker run --rm --init --memory=1500m -e DIST=dist2 $V pr12865-linux"
DN="docker run --rm --init --memory=1500m --network pr12964net -e DIST=dist2 $V pr12865-linux"
DM="docker run --rm --init --memory=1500m --network container:pr12964-db -e DIST=dist2 $V"
until docker exec pr12964-db mysqladmin -uroot -prootpw ping >/dev/null 2>&1; do sleep 2; done
docker exec pr12964-db mysql -uroot -prootpw -e "CREATE USER IF NOT EXISTS 'sa'@'%' IDENTIFIED BY ''; GRANT ALL PRIVILEGES ON *.* TO 'sa'@'%';" 2>/dev/null
echo "== $(date +%T) load $(uptime | sed 's/.*averages: //') F1: durable gate, H2"
$D /rig/run-gates.sh src-main2 r2-main-durable 1 'DurableLocalRuntimeFaultGateTest' 2>&1 | grep -E "run [0-9]|ERROR\]   " | head -4
$D /rig/run-gates.sh src-merge2 r2-merge-durable 2 'DurableLocalRuntimeFaultGateTest' 2>&1 | grep -E "run [0-9]|ERROR\]   " | head -6
$D /rig/run-gates.sh src-cand2 r2-cand-durable 2 'DurableLocalRuntimeFaultGateTest' 2>&1 | grep -E "run [0-9]|ERROR\]   " | head -6
echo "== $(date +%T) all Stage F gates with the candidate, H2"
$D /rig/run-gates.sh src-cand2 r2-cand-gates 1 '*FaultGate*' 2>&1 | tail -6
echo "== $(date +%T) F1 on MySQL 8.4: merge (no candidate), candidate, main"
$DM pr12865-linux /rig/run-gates-mysql2.sh src-mysql2-nocand r2-durable-mysql-nocand 1 'DurableLocalRuntimeFaultGateTest' 2>&1 | grep -E "run [0-9]|ERROR\]   " | head -4
$DM pr12865-linux /rig/run-gates-mysql2.sh src-mysql2 r2-gates-mysql 1 'DurableLocalRuntimeFaultGateTest,ProcessCrashFaultGateTest,ConcurrencyStorageFaultGateTest,LostResponseFaultGateTest' 2>&1 | tail -5
$DM pr12865-linux /rig/run-gates-mysql2.sh src-main2-mysql r2-durable-mysql-main 1 'DurableLocalRuntimeFaultGateTest' 2>&1 | grep -E "run [0-9]|ERROR\]   " | head -4
echo "== $(date +%T) G2 probe on MySQL 8.4 (main + PR vs main)"
$DM -e EXTRA="-Dg2.arm=merge -Dg2.out=/rig/out/r2-g2probe.jsonl" pr12865-linux /rig/run-gates-mysql2.sh src-mysql2 r2-probe-merge 1 'G2ProbeFaultGateTest' 2>&1 | tail -3
$DM -e EXTRA="-Dg2.arm=main -Dg2.out=/rig/out/r2-g2probe.jsonl" pr12865-linux /rig/run-gates-mysql2.sh src-main2-mysql r2-probe-main 1 'G2ProbeFaultGateTest' 2>&1 | tail -3
echo "== $(date +%T) unit suites (main + PR)"
$D /rig/run-unit.sh src-merge2 r2-merge-broker-unit runtime-broker test checkstyle:check 2>&1 | tail -4
$D /rig/run-unit.sh src-merge2 r2-merge-server managed-agent-server test 2>&1 | tail -4
echo "== $(date +%T) shared ledger contract ITs on MySQL 8.4 / MariaDB 10.11"
$DN /rig/run-it2.sh src-merge2 r2-it-broker-mysql84 runtime-broker pr12964-db r2_rb_mysql rootpw 2>&1 | tail -5
$DN /rig/run-it2.sh src-merge2 r2-it-broker-maria runtime-broker pr12964-maria r2_rb_maria rootpw 2>&1 | tail -5
$DN /rig/run-it2.sh src-merge2 r2-it-server-mysql84 managed-agent-server pr12964-db r2_ma_mysql rootpw 2>&1 | tail -5
$DN /rig/run-it2.sh src-merge2 r2-it-server-maria managed-agent-server pr12964-maria r2_ma_maria rootpw 2>&1 | tail -5
echo "== $(date +%T) F2: awaitLeaseExpiry, 10 runs each"
$D /rig/run-loop.sh src-merge2 r2-lease-orig 10 'TakeoverReconciliationTest#expired*+unavailable*' 2>&1 | tail -3
$D /rig/run-loop.sh src-flakecand2 r2-lease-cand 10 'TakeoverReconciliationTest#expired*+unavailable*' 2>&1 | tail -3
echo "== $(date +%T) done"
