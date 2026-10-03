#!/bin/bash
# VERIFICATION RIG ONLY (PR #13168 R2), macOS host, JDK 21: build the server fat jar + rig actor adapter.
set -u
R=/Users/wenshao/pr13168-r2; W=$R/${1:-wt}; L=${2:-head}
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/wenshao/Install/maven/bin
M2="-Dmaven.repo.local=/Users/wenshao/pr13168-r2/m2"; O=$R/out/build-java-$L.log; SJ=$W/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $M2 -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $M2 -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $M2 -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$R/server/$L-server.jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16) head=$(git -C $W rev-parse --short HEAD)"
rm -rf $R/adapter-build && mkdir -p $R/adapter-build/x $R/adapter-build/classes
(cd $R/adapter-build/x && unzip -q -o $j 'BOOT-INF/classes/*' 'BOOT-INF/lib/*')
CP="$R/adapter-build/x/BOOT-INF/classes:$(ls $R/adapter-build/x/BOOT-INF/lib/*.jar | tr '\n' ':')"
javac -cp "$CP" -d $R/adapter-build/classes $(find /Users/wenshao/pr13166-rig/adapter-src -name '*.java') >> $O 2>&1; echo "[$L] adapter javac exit=$?"
(cd $R/adapter-build/classes && jar cf $R/adapter.jar .) ; rm -rf $R/adapter-build/x
echo "[$L] BUILD-DONE $(date -u +%T)"
