#!/bin/bash
# VERIFICATION RIG ONLY: macOS host, JDK 21: build the server fat jar (the PR touches no Java; built once from the trial merge).
set -u
RIG=/Users/wenshao/pr13179-rig; W=$RIG/${1:-wt}; L=${2:-merge}
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
R="-Dmaven.repo.local=$RIG/m2"; O=$RIG/out/build-java-$L.log; SJ=$W/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$RIG/server/$L-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16)"
rm -rf $RIG/adapter-build && mkdir -p $RIG/adapter-build/x $RIG/adapter-build/classes
(cd $RIG/adapter-build/x && unzip -q -o $j 'BOOT-INF/classes/*' 'BOOT-INF/lib/*')
CP="$RIG/adapter-build/x/BOOT-INF/classes:$(ls $RIG/adapter-build/x/BOOT-INF/lib/*.jar | tr '\n' ':')"
javac -cp "$CP" -d $RIG/adapter-build/classes $(find $RIG/adapter-src -name '*.java') >> $O 2>&1; echo "[$L] adapter javac exit=$?"
(cd $RIG/adapter-build/classes && jar cf $RIG/adapter.jar .) ; rm -rf $RIG/adapter-build/x
echo "[$L] JAVA-DONE $(date -u +%T)"
