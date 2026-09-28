#!/bin/bash
# Run the F1 candidate test + gap tests against the CANDIDATE build (all must pass there).
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/r3; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sort -u | tr '\n' ';'; }
rm -rf /w-candt && mkdir -p /w-candt && cp -a /rig/cand-src-v4/. /w-candt/
(cd /w-candt/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
cp /rig/cand/MaintenanceProbeWaiterTest.java /rig/cand/RebootRecoveryGapTest.java /w-candt/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
(cd /w-candt/packages/sdk-java/runtime-broker && mvn -B -ntp test -Dtest='MaintenanceProbeWaiterTest,RebootRecoveryGapTest' -Dcheckstyle.skip=true > $O/cand-newtests.log 2>&1; echo "[candidate] F1 test + gap tests: exit=$? $(summary $O/cand-newtests.log) $(failing $O/cand-newtests.log)")
echo CAND-NEWTESTS-DONE
