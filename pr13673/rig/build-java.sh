#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): build server fat jar from one worktree with an isolated m2.  usage: build-java.sh <arm>
set -u
RIG=/Users/wenshao/pr13673-rig; A=$1; W=/Users/wenshao/git/qwen-code-pr13673-$A; M2=$RIG/m2-$A
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
R="-Dmaven.repo.local=$M2"; O=$RIG/out/build-java-$A.log; SJ=$W/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$A] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install >> $O 2>&1); echo "[$A] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package >> $O 2>&1); echo "[$A] server package exit=$?"
j=$RIG/server/$A-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16) head=$(git -C $W rev-parse --short HEAD)"
echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_0-9]*' | sed 's#db/migration/##' | sort -V | uniq | tail -3 | tr '\n' ' ')"
echo "[$A] BUILD-DONE $(date -u +%T)"
