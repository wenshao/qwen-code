#!/bin/bash
# host JDK 21: build the Managed Agent Server fat jar in a worktree with an isolated m2. usage: build-jar.sh <arm>
set -u
A=$1; RIG=/Users/wenshao/pr13366-rig; W=$RIG/src-$A; SJ=$W/packages/sdk-java; L=$RIG/out/jar-$A.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn
M2=$RIG/m2-$A
if [ ! -d $M2 ]; then cp -Rc ~/.m2/repository $M2 && rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker $M2/com/alibaba/qwen-managed-agent-server; fi
R="-Dmaven.repo.local=$M2"
echo "=== $(date +%T) $A jar build ($(git -C $W rev-parse --short HEAD)) $(java -version 2>&1|head -1)" | tee $L
(cd $SJ/qwencode && $MVN -B -ntp -q -o $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) >> $L 2>&1; echo "[$A] qwencode install exit=$?" | tee -a $L
(cd $SJ/runtime-broker && $MVN -B -ntp -q -o $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install) >> $L 2>&1; echo "[$A] broker install exit=$?" | tee -a $L
(cd $SJ/managed-agent-server && $MVN -B -ntp -q -o $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package) >> $L 2>&1; echo "[$A] server package exit=$?" | tee -a $L
j=$SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
mkdir -p $RIG/server; cp $j $RIG/server/$A-server.jar
echo "== $A-server.jar sha256=$(shasum -a 256 $j | cut -c1-16) size=$(stat -f %z $j) migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-zA-Z_]*' | sed 's#db/migration/##' | sort -V | tail -2 | tr '\n' ' ')" | tee -a $L
echo "[$A] JAR-DONE"
