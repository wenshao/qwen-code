#!/bin/bash
R=/Users/wenshao/pr12964-rig
V="-v $R:/rig -v $R/m2:/root/.m2/repository"
D="docker run --rm --init --memory=1500m $V pr12865-linux"
DN="docker run --rm --init --memory=1500m --network pr12964net $V pr12865-linux"
DM="docker run --rm --init --memory=1500m --network container:pr12964-db $V"
until docker exec pr12964-db mysqladmin -uroot -prootpw ping >/dev/null 2>&1; do sleep 2; done
docker exec pr12964-db mysql -uroot -prootpw -e "CREATE USER IF NOT EXISTS 'sa'@'%' IDENTIFIED BY ''; GRANT ALL PRIVILEGES ON *.* TO 'sa'@'%';" 2>/dev/null
echo "== $(date +%T) G2 probe v2 on MySQL 8.4 (merge vs main)"
$DM -e EXTRA="-Dg2.arm=merge -Dg2.out=/rig/out/g2probe2.jsonl" pr12865-linux /rig/run-gates-mysql2.sh src-mysql probe2-merge 1 'G2ProbeFaultGateTest' 2>&1 | tail -4
$DM -e EXTRA="-Dg2.arm=main -Dg2.out=/rig/out/g2probe2.jsonl" pr12865-linux /rig/run-gates-mysql2.sh src-main-mysql probe2-main 1 'G2ProbeFaultGateTest' 2>&1 | tail -4
echo "== $(date +%T) durable gate on MySQL 8.4: merge without candidate, then main"
$DM pr12865-linux /rig/run-gates-mysql2.sh src-mysql-nocand durable-mysql-nocand 1 'DurableLocalRuntimeFaultGateTest' 2>&1 | tail -4
$DM pr12865-linux /rig/run-gates-mysql2.sh src-main-mysql durable-mysql-main 1 'DurableLocalRuntimeFaultGateTest' 2>&1 | tail -4
echo "== $(date +%T) runtime-broker ITs (shared contract) on MySQL 8.4 / MariaDB 10.11"
$DN /rig/run-it2.sh src-merge it2-broker-mysql84 runtime-broker pr12964-db rb_it2_mysql rootpw 2>&1 | tail -6
$DN /rig/run-it2.sh src-merge it2-broker-maria runtime-broker pr12964-maria rb_it2_maria rootpw 2>&1 | tail -6
echo "== $(date +%T) lease-expiry flake: original vs candidate (20 runs each)"
$D /rig/run-loop.sh src-merge lease-orig 20 'TakeoverReconciliationTest#expired*+unavailable*' 2>&1 | tail -6
$D /rig/run-loop.sh src-flakecand lease-cand 20 'TakeoverReconciliationTest#expired*+unavailable*' 2>&1 | tail -6
echo "== $(date +%T) done"
