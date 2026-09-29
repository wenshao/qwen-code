#!/bin/bash
# macOS host: control on the used database, then the renamed arm again on a fresh one.
set -u
RIG=/rig
V() { colima ssh -p pr12869 -- "$@"; }
RUN="docker run --rm --init --network host -v $RIG:/rig -v $RIG/m2:/root/.m2/repository:ro pr12865-linux:latest"
DBQ() { V docker exec w0e3-mariadb mariadb -uroot -pruntime-broker -N -B -e "$1"; }
echo "rows left by earlier runs: $(DBQ "SELECT COUNT(*) FROM runtime_broker_test.qwen_runtime_binding WHERE tenant_id LIKE 'mysql-%'") bindings with the contract's prefix"
V $RUN bash /rig/ci-mariadb-control.sh used-database
DBQ "DROP DATABASE runtime_broker_test; CREATE DATABASE runtime_broker_test; DROP DATABASE IF EXISTS managed_agent_test_renamed"
echo "database runtime_broker_test dropped and created again: $(DBQ "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='runtime_broker_test'") tables"
mkdir -p $RIG/out/ci-renamed-used-database && mv $RIG/out/ci-renamed/mariadb-*.log $RIG/out/ci-renamed-used-database/
V $RUN bash /rig/ci-mariadb-job.sh renamed
echo RERUN-DONE
