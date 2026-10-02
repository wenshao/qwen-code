#!/bin/bash
# container (VM, Java 21 + Maven): build several server jars, copying the Maven cache once.  usage: build-jar-multi.sh <tree>:<label> ...
set -u
O=/rig/out/build; mkdir -p $O /rig/server
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
for spec in "$@"; do
  TREE=${spec%%:*}; L=${spec#*:}
  W=/b-$L; SJ=$W/packages/sdk-java
  rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
  (cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1); echo "[$L] qwencode install exit=$?"
  (cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install >> $O/$L.log 2>&1); echo "[$L] broker install exit=$?"
  (cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests clean package >> $O/$L.log 2>&1); echo "[$L] server package (with checkstyle) exit=$?"
  for f in $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha*.jar; do
    b=$(basename $f .jar); suffix=${b#qwen-managed-agent-server-0.1.0-alpha}; cp $f /rig/server/$L-server$suffix.jar
  done
  for j in /rig/server/$L-server*.jar; do
    echo "== $j sha256=$(sha256sum $j | cut -c1-16) $(unzip -p $j META-INF/MANIFEST.MF | grep -E '^(Main-Class|Start-Class)' | tr -d '\r' | tr '\n' ' ')"
    echo "   migrations: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tail -4 | tr '\n' ' ')"
  done
  rm -rf $W
  echo "[$L] BUILD-DONE"
done
