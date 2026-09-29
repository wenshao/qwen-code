#!/bin/bash
# container: build server + operator-recovery jars from a source tree.  usage: build.sh <tree> <label>
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/build; mkdir -p $O /rig/server
W=/b-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/ && rm -rf $W/dist
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install > $O/$L.log 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O/$L.log 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O/$L.log 2>&1); echo "[$L] server package exit=$?"
ls -la $SJ/managed-agent-server/target/*.jar
for j in $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha*.jar; do
  b=$(basename $j .jar); suffix=${b#qwen-managed-agent-server-0.1.0-alpha}; cp $j /rig/server/$L-server$suffix.jar
done
ls -la /rig/server/
for j in /rig/server/$L-*.jar; do
  echo "== $j: Main-Class=$(unzip -p $j META-INF/MANIFEST.MF | grep -E '^Start-Class' | tr -d '\r')  V19 in jar=$(unzip -l $j | grep -c V19__) RecoveryCommand=$(unzip -l $j | grep -c WorkspaceRecoveryCommand)"
  unzip -p $j 'BOOT-INF/lib/qwen-managed-runtime-broker-*.jar' > /tmp/rb.jar; echo "   embedded broker has attestOperatorStop: $(unzip -p /tmp/rb.jar com/alibaba/qwen/code/runtimebroker/LocalProcessRuntimeProvisioner.class | grep -a -c attestOperatorStop)"
done
echo BUILD-DONE
