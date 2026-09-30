#!/bin/bash
# macOS host, JDK 21: build the server fat jar from a source tree.  usage: build-java.sh <tree-dir> <label>
set -u
RIG=/rig; TREE=$1; L=$2
export JAVA_HOME=/opt/jdk21; export PATH=$JAVA_HOME/bin:$PATH
R="-Dmaven.repo.local=$RIG/m2-$L"; O=$RIG/out/build-java-$L.log; SJ=$RIG/$TREE/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$RIG/server/$L-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16)"
echo "   ManagedActionController=$(unzip -l $j | grep -c 'api/ManagedActionController.class')"
echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tr '\n' ' ')"
echo "[$L] BUILD-DONE $(date -u +%T)"
