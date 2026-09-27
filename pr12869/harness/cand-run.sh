#!/bin/bash
# container: A/B of the candidate (healthy waiters are served) against the PR head
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
T=src/test/java/com/alibaba/qwen/code/runtimebroker
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1; }
# --- arm 1: PR head + the new test
rm -rf /w-head && mkdir -p /w-head && cp -a /rig/src/. /w-head/
cp /rig/cand/MaintenanceProbeWaiterTest.java /w-head/packages/sdk-java/runtime-broker/$T/
cd /w-head/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1
cd ../runtime-broker
mvn -B -ntp test -Dtest=MaintenanceProbeWaiterTest -Dcheckstyle.skip=true > /rig/out/cand-head-newtest.log 2>&1
echo "[PR head]   new test: exit=$? $(summary /rig/out/cand-head-newtest.log)"
grep -E "runtime_reconciliation_required|Maintenance observation|RuntimeBrokerException" /rig/out/cand-head-newtest.log | head -3
# --- arm 2: candidate
rm -rf /w-cand && mkdir -p /w-cand && cp -a /rig/cand-src/. /w-cand/
cd /w-cand/packages/sdk-java/runtime-broker
mvn -B -ntp test -Dtest=MaintenanceProbeWaiterTest -Dcheckstyle.skip=true > /rig/out/cand-cand-newtest.log 2>&1
echo "[candidate] new test: exit=$? $(summary /rig/out/cand-cand-newtest.log)"
mvn -B -ntp install > /rig/out/cand-broker-unit.log 2>&1
echo "[candidate] broker unit + checkstyle + install: exit=$? $(summary /rig/out/cand-broker-unit.log)"
mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/src/dist/cli.js > /rig/out/cand-broker-gates.log 2>&1
echo "[candidate] fault gates: exit=$? $(summary /rig/out/cand-broker-gates.log)"
cd ../managed-agent-server
mvn -B -ntp verify -Phosted-harness-mysql -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=/rig/src/dist/cli.js > /rig/out/cand-recovery-it.log 2>&1
echo "[candidate] WorkspaceRecoveryWorkerIT: exit=$? $(summary /rig/out/cand-recovery-it.log)"
mvn -B -ntp package > /rig/out/cand-server-unit.log 2>&1
echo "[candidate] server unit + package: exit=$? $(summary /rig/out/cand-server-unit.log)"
cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/cand-server.jar && ls -la /rig/server/
