#!/bin/bash
# container (JDK 21): run the connector + coordinator unit tests for a tree, optionally with the
# candidate's test file dropped onto it.  usage: unit-cand.sh <tree> <label> [test-file-from-tree]
set -u
TREE=$1; L=$2; OVERLAY=${3:-}
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
W=/u-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W/packages && cp -a /rig/$TREE/packages/sdk-java $W/packages/ && rm -rf $SJ/*/target
T=managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/harness/QwenHostedHarnessConnectorTest.java
[ -n "$OVERLAY" ] && cp /rig/$OVERLAY/packages/sdk-java/$T $SJ/$T
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > /rig/out/build/unit-$L.log 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install >> /rig/out/build/unit-$L.log 2>&1)
(cd $SJ/managed-agent-server && mvn -B -ntp $R -Dtest='QwenHostedHarnessConnectorTest,HarnessCoordinatorTest' -Dsurefire.failIfNoSpecifiedTests=false test >> /rig/out/build/unit-$L.log 2>&1); echo "[$L] unit exit=$?"
grep -E "Tests run:|FAIL|ERROR\]   |expected|Wanted but|never\(\)|BUILD" /rig/out/build/unit-$L.log | grep -v "^\[INFO\] $" | cut -c1-220 | head -24
