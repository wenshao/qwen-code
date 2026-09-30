#!/bin/bash
# VERIFICATION RIG ONLY (PR #13117): build the server fat jar from a worktree.  usage: build-java.sh <wt-dir> <label>
set -u
RIG=/Users/wenshao/pr13117-rig; TREE=$1; L=$2
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
[ -d $RIG/m2-$L ] || cp -Rc /Users/wenshao/pr13101-rig/m2-mainnow $RIG/m2-$L
R="-Dmaven.repo.local=$RIG/m2-$L"; O=$RIG/out/build-java-$L.log; SJ=$RIG/$TREE/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q -o $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q -o $R -DskipTests -Dcheckstyle.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q -o $R -DskipTests -Dcheckstyle.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$RIG/server/$L-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16)"
echo "   contract version in jar: $(unzip -p $j BOOT-INF/classes/openapi/managed-agent-public-api.openapi.json | grep -o '"version": "[0-9.]*"' | head -1)"
echo "[$L] BUILD-DONE $(date -u +%T)"
