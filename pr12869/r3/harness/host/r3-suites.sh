#!/bin/bash
# round 3 suites-only re-run (trees now carry packages/cli/src/serve/contracts).
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/r3; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
prep() { rm -rf $2 && mkdir -p $2 && cp -a /rig/$1/. $2/ && (cd $2/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1); }
prep src-v4 /w-head
prep cand-src-v4 /w-cand
# candidate first, head last (head broker then lives in the local repository for the head server suite)
(cd /w-cand/packages/sdk-java/runtime-broker && mvn -B -ntp install > $O/cand-u-broker.log 2>&1; echo "[candidate] broker unit + checkstyle (incl. 3 new tests): exit=$? $(summary $O/cand-u-broker.log) $(failing $O/cand-u-broker.log)")
(cd /w-cand/packages/sdk-java/managed-agent-server && mvn -B -ntp test > $O/cand-u-server.log 2>&1; echo "[candidate] server unit + checkstyle: exit=$? $(summary $O/cand-u-server.log) $(failing $O/cand-u-server.log)")
(cd /w-head/packages/sdk-java/runtime-broker && mvn -B -ntp install > $O/head-u-broker.log 2>&1; echo "[8c2b626c] broker unit + checkstyle: exit=$? $(summary $O/head-u-broker.log) $(failing $O/head-u-broker.log)")
(cd /w-head/packages/sdk-java/managed-agent-server && mvn -B -ntp test > $O/head-u-server.log 2>&1; echo "[8c2b626c] server unit + checkstyle: exit=$? $(summary $O/head-u-server.log) $(failing $O/head-u-server.log)")
cp /rig/cand/MaintenanceProbeWaiterTest.java /rig/cand/RebootRecoveryGapTest.java /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
(cd /w-head/packages/sdk-java/runtime-broker && mvn -B -ntp test -Dtest='MaintenanceProbeWaiterTest,RebootRecoveryGapTest' -Dcheckstyle.skip=true > $O/head-newtests.log 2>&1; echo "[8c2b626c] F1 test + gap tests: exit=$? $(summary $O/head-newtests.log) $(failing $O/head-newtests.log)")
rm /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/MaintenanceProbeWaiterTest.java /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/RebootRecoveryGapTest.java
echo SUITES-DONE
