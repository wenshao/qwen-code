#!/bin/bash
# macOS host, JDK 21: build the server fat jar from one worktree.  usage: build-java.sh <label> <worktree> <m2>
set -u
RIG=/Users/wenshao/pr13135-rig; L=$1; W=$2; M2=$3
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
R="-Dmaven.repo.local=$M2"; O=$RIG/out/build-java-$L.log; SJ=$W/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q -o $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q -o $R -DskipTests -Dcheckstyle.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q -o $R -DskipTests -Dcheckstyle.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$RIG/server/$L-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16) head=$(git -C $W rev-parse --short HEAD)"
echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_0-9]*' | sed 's#db/migration/##' | sort -V | uniq | tail -3 | tr '\n' ' ')"
echo "[$L] BUILD-DONE $(date -u +%T)"
