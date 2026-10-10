#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682): build the server fat jar for one arm.  usage: build-java.sh <arm>
set -u
V=/root/v13682; A=$1; W=$V/$A; SJ=$W/packages/sdk-java; O=$V/out/build-java-$A.log
export JAVA_HOME=/opt/jdk21 PATH=/opt/jdk21/bin:$V/tools/apache-maven-3.9.9/bin:$PATH
R="-Dmaven.repo.local=$V/m2-$A -Dmaven.repo.local.tail=/root/.m2/repository"
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$A] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install >> $O 2>&1); echo "[$A] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package >> $O 2>&1); echo "[$A] server package exit=$?"
mkdir -p $V/server; j=$V/server/$A-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j 2>/dev/null || ls $SJ/managed-agent-server/target/
echo "== $j sha256=$(sha256sum $j | cut -c1-16) head=$(git -C $W rev-parse --short HEAD)"
echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_0-9]*' | sed 's#db/migration/##' | sort -V | uniq | tail -3 | tr '\n' ' ')"
echo "[$A] BUILD-DONE $(date -u +%T)"
