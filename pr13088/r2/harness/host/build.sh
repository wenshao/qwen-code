#!/bin/bash
# container (VM, Java 21): build the server fat jar from a source export.  usage: build.sh <tree> <label>
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/build; mkdir -p $O /rig/server
W=/b-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O/$L.log 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O/$L.log 2>&1); echo "[$L] server package exit=$?"
ls -la $SJ/managed-agent-server/target/*.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/$L-server.jar
j=/rig/server/$L-server.jar
echo "== $j sha256=$(sha256sum $j | cut -c1-16) Start-Class=$(unzip -p $j META-INF/MANIFEST.MF | grep -E '^Start-Class' | tr -d '\r')"
echo "   V21 in jar=$(unzip -l $j | grep -c 'V21__')  WorkspaceStorageGuard=$(unzip -l $j | grep -c 'store/WorkspaceStorageGuard.class')  RegistrationMain=$(unzip -l $j | grep -c 'WorkspaceStorageRegistrationMain.class')"
echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tr '\n' ' ')"
echo "[$L] BUILD-DONE"
