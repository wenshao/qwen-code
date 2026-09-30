#!/bin/bash
# macOS host, JDK 21: build the server fat jar from a source tree with a private Maven repository.  usage: build-java.sh <tree-dir> <label>
set -u
. /rig/rig.env
TREE=$1; L=$2
export JAVA_HOME PATH=$JAVA_HOME/bin:$PATH
[ -d $RIG/m2-$L ] || cp -Rc /rig-other/m2 $RIG/m2-$L
rm -rf $RIG/m2-$L/com/alibaba/qwen* 2>/dev/null
R="-Dmaven.repo.local=$RIG/m2-$L"; O=$RIG/out/build-java-$L.log; SJ=$RIG/$TREE/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$RIG/server/$L-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16)"
echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tr '\n' ' ')"
echo "[$L] BUILD-DONE $(date -u +%T)"
