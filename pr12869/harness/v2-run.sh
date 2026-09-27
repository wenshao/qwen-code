#!/bin/bash
# container: new head f8bf5d74 — jars first, then suites, then candidate A/B
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
T=src/test/java/com/alibaba/qwen/code/runtimebroker
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1; }
build() { # <tree> <jarname>
  rm -rf /w-$2 && mkdir -p /w-$2 && cp -a /rig/$1/. /w-$2/
  (cd /w-$2/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
  (cd /w-$2/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > /rig/out/v2-build-$2.log 2>&1)
  (cd /w-$2/packages/sdk-java/managed-agent-server && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true package >> /rig/out/v2-build-$2.log 2>&1 && cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/$2.jar)
  echo "[build] $2.jar $(ls -la /rig/server/$2.jar 2>&1 | awk '{print $5}') bytes"
}
build cand-src-v2 cand-v2-server
build src-v2 v2-server
echo JARS-READY
cd /w-v2-server/packages/sdk-java/runtime-broker
mvn -B -ntp install > /rig/out/v2-u-broker.log 2>&1; echo "[f8bf5d74] broker unit: exit=$? $(summary /rig/out/v2-u-broker.log)"
mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/src-v2/dist/cli.js > /rig/out/v2-g-broker.log 2>&1; echo "[f8bf5d74] fault gates: exit=$? $(summary /rig/out/v2-g-broker.log)"
cd ../managed-agent-server
mvn -B -ntp test > /rig/out/v2-u-server.log 2>&1; echo "[f8bf5d74] server unit: exit=$? $(summary /rig/out/v2-u-server.log)"; grep -E '<<< (FAILURE|ERROR)' /rig/out/v2-u-server.log | grep -v ' in com' | cut -c1-200
mvn -B -ntp verify -Phosted-harness-mysql -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=/rig/src-v2/dist/cli.js > /rig/out/v2-it-recovery.log 2>&1; echo "[f8bf5d74] WorkspaceRecoveryWorkerIT: exit=$? $(summary /rig/out/v2-it-recovery.log)"
# candidate A/B on the new head
cp /rig/cand/MaintenanceProbeWaiterTest.java /w-v2-server/packages/sdk-java/runtime-broker/$T/
cd /w-v2-server/packages/sdk-java/runtime-broker
mvn -B -ntp test -Dtest=MaintenanceProbeWaiterTest -Dcheckstyle.skip=true > /rig/out/v2-head-newtest.log 2>&1; echo "[f8bf5d74] new test: exit=$? $(summary /rig/out/v2-head-newtest.log)"
rm /w-v2-server/packages/sdk-java/runtime-broker/$T/MaintenanceProbeWaiterTest.java
cd /w-cand-v2-server/packages/sdk-java/runtime-broker
mvn -B -ntp test -Dtest=MaintenanceProbeWaiterTest -Dcheckstyle.skip=true > /rig/out/v2-cand-newtest.log 2>&1; echo "[candidate] new test: exit=$? $(summary /rig/out/v2-cand-newtest.log)"
mvn -B -ntp install > /rig/out/v2-cand-u-broker.log 2>&1; echo "[candidate] broker unit + checkstyle: exit=$? $(summary /rig/out/v2-cand-u-broker.log)"
mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/src-v2/dist/cli.js > /rig/out/v2-cand-g-broker.log 2>&1; echo "[candidate] fault gates: exit=$? $(summary /rig/out/v2-cand-g-broker.log)"
cd ../managed-agent-server
mvn -B -ntp test > /rig/out/v2-cand-u-server.log 2>&1; echo "[candidate] server unit: exit=$? $(summary /rig/out/v2-cand-u-server.log)"
mvn -B -ntp verify -Phosted-harness-mysql -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=/rig/src-v2/dist/cli.js > /rig/out/v2-cand-it-recovery.log 2>&1; echo "[candidate] WorkspaceRecoveryWorkerIT: exit=$? $(summary /rig/out/v2-cand-it-recovery.log)"
echo ALL-DONE
