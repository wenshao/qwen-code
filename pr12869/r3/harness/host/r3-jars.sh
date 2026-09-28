#!/bin/bash
# round 3 (head 8c2b626c): build both jars, run unit suites and the two carried-forward test classes.
# Container on the host; MySQL ITs use the host MySQL on 127.0.0.1:33306.
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/r3; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
prep() { # <tree> <workdir>
  rm -rf $2 && mkdir -p $2 && cp -a /rig/$1/. $2/
  (cd $2/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
}
for arm in head cand; do
  tree=src-v4; [ $arm = cand ] && tree=cand-src-v4
  prep $tree /w-$arm
  (cd /w-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/build-$arm.log 2>&1)
  (cd /w-$arm/packages/sdk-java/managed-agent-server && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true package >> $O/build-$arm.log 2>&1 && cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/r3-$arm-server.jar)
  echo "[build] r3-$arm-server.jar $(ls -la /rig/server/r3-$arm-server.jar 2>&1 | awk '{print $5}') bytes"
done
echo JARS-READY
# head installed last so the local repository holds the head broker for the head server suite
(cd /w-head/packages/sdk-java/runtime-broker && mvn -B -ntp install > $O/head-u-broker.log 2>&1; echo "[8c2b626c] broker unit + checkstyle: exit=$? $(summary $O/head-u-broker.log) $(failing $O/head-u-broker.log)")
(cd /w-head/packages/sdk-java/managed-agent-server && mvn -B -ntp test > $O/head-u-server.log 2>&1; echo "[8c2b626c] server unit + checkstyle: exit=$? $(summary $O/head-u-server.log) $(failing $O/head-u-server.log)")
cp /rig/cand/MaintenanceProbeWaiterTest.java /rig/cand/RebootRecoveryGapTest.java /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
(cd /w-head/packages/sdk-java/runtime-broker && mvn -B -ntp test -Dtest='MaintenanceProbeWaiterTest,RebootRecoveryGapTest' -Dcheckstyle.skip=true > $O/head-newtests.log 2>&1; echo "[8c2b626c] F1 test + gap tests: exit=$? $(summary $O/head-newtests.log) $(failing $O/head-newtests.log)")
rm /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/MaintenanceProbeWaiterTest.java /w-head/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/RebootRecoveryGapTest.java
(cd /w-cand/packages/sdk-java/runtime-broker && mvn -B -ntp install > $O/cand-u-broker.log 2>&1; echo "[candidate] broker unit + checkstyle (incl. 3 new tests): exit=$? $(summary $O/cand-u-broker.log) $(failing $O/cand-u-broker.log)")
(cd /w-cand/packages/sdk-java/managed-agent-server && mvn -B -ntp test > $O/cand-u-server.log 2>&1; echo "[candidate] server unit + checkstyle: exit=$? $(summary $O/cand-u-server.log) $(failing $O/cand-u-server.log)")
echo STAGE-JARS-DONE
