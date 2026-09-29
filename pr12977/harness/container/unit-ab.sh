#!/bin/bash
# container: WorkspaceRuntimeTest + WorkspaceRecoveryCommandTest on one tree; optional jar build.  usage: unit-ab.sh <tree> <label> [jar]
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/unit-ab; mkdir -p $O
W=/u-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/ && rm -rf $W/dist
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install > /dev/null 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install > $O/$L-pre.log 2>&1)
(cd $SJ/managed-agent-server && mvn -B -ntp $R test -Dtest='WorkspaceRuntimeTest,WorkspaceRecoveryCommandTest' > $O/$L.log 2>&1); echo "[$L] WorkspaceRuntimeTest+WorkspaceRecoveryCommandTest (+checkstyle): exit=$?"
grep -E "Tests run:.*-- in " $O/$L.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed[^-]*-- in / -- /'; grep -E '<<< (FAILURE|ERROR)!' $O/$L.log | head -4
grep -A3 "operatorRecoveryInspectsTheDeferredShellReference" $O/$L.log | grep -E "IllegalState|Exception" | head -2
if [ -n "${3:-}" ]; then
  (cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O/$L-pre.log 2>&1)
  cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/$3-server.jar
  cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha-operator-recovery.jar /rig/server/$3-server-operator-recovery.jar
  echo "[$L] built /rig/server/$3-server*.jar"
fi
