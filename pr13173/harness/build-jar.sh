#!/bin/bash
# container (JDK 21): build the Managed Agent Server fat jar from a tree on local disk and put it back
# where the E2E runner looks for it.  usage: build-jar.sh <tree> <label>
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/build; mkdir -p $O /rig/server
W=/b-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W/packages/core/src/managed-runtime && cp -a /rig/$TREE/packages/sdk-java $W/packages/ && rm -rf $SJ/*/target
[ -d /rig/$TREE/packages/core/src/managed-runtime/contracts ] && cp -a /rig/$TREE/packages/core/src/managed-runtime/contracts $W/packages/core/src/managed-runtime/
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O/$L.log 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O/$L.log 2>&1); echo "[$L] server package exit=$?"
j=$SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
cp $j /rig/server/$L-server.jar
mkdir -p /rig/$TREE/packages/sdk-java/managed-agent-server/target && cp $j /rig/$TREE/packages/sdk-java/managed-agent-server/target/
echo "== $L-server.jar sha256=$(sha256sum $j | cut -c1-16) size=$(stat -c %s $j) $(java -version 2>&1 | head -1)"
echo "   TrustedActorHeaderFilter=$(jar tf $j | grep -c 'TrustedActorHeaderFilter.class')  migrations: $(jar tf $j | grep -o 'db/migration/V[0-9]*__[a-zA-Z_]*' | sed 's#db/migration/##' | sort -V | tail -3 | tr '\n' ' ')"
echo "[$L] BUILD-DONE"
