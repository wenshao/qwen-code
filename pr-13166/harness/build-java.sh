#!/bin/bash
# VERIFICATION RIG ONLY (PR #13166): build the managed-agent server jar from one worktree.
set -u
W=$1/packages/sdk-java; L=$2; RIG=/root/verify/pr13166/rig
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
R="-Dmaven.repo.local=$RIG/m2 -Dmaven.repo.local.tail=/root/.m2/repository"
O=$RIG/out/build-java-$L.log; : > $O
SK="-DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.javadoc.skip=true -Dgpg.skip=true"
for m in qwencode runtime-broker; do
  (cd $W/$m && mvn -B -ntp $R $SK install >> $O 2>&1) || { echo "EXIT=1 $m" | tee -a $O; exit 1; }
done
(cd $W/managed-agent-server && mvn -B -ntp $R $SK package >> $O 2>&1) || { echo "EXIT=1 server" | tee -a $O; exit 1; }
cp $W/managed-agent-server/target/qwen-managed-agent-server-*.jar $RIG/server/$L-server.jar
echo "EXIT=0 jar=$RIG/server/$L-server.jar migrations=$(unzip -l $RIG/server/$L-server.jar | grep -o 'db/migration/V[0-9]*__' | sort -V | uniq | tail -1)" | tee -a $O
