#!/bin/bash
# JDK 21, isolated m2. Builds server jars: pr (trial merge), prefix (pr with
# 950d757813's runtime-broker main changes reverted = 33581eaa63 logic),
# base (main d28bc60d73 Java sources).
set -u
RIG=/Users/wenshao/pr13986-rig; W=$RIG/src-pr; SJ=$W/packages/sdk-java; L=$RIG/out/build-jar.log
MAIN=d28bc60d73dd1b613086cdff8be6c307b9609505
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn
M2=$RIG/m2
[ -d $M2 ] || { cp -Rc ~/.m2/repository $M2 && rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker $M2/com/alibaba/qwen-managed-agent-server; }
R="-Dmaven.repo.local=$M2"
mkdir -p $RIG/server
build() { # build <arm>
  local A=$1
  echo "=== $(date +%T) jar $A $(java -version 2>&1|head -1)" | tee -a $L
  (cd $SJ/qwencode && $MVN -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) >> $L 2>&1; echo "[$A] qwencode exit=$?" | tee -a $L
  (cd $SJ/runtime-broker && $MVN -B -ntp -q $R -Dmaven.test.skip=true -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true clean install) >> $L 2>&1; rc=$?; echo "[$A] broker exit=$rc" | tee -a $L; [ $rc = 0 ] || { echo "[$A] ABORT broker failed" | tee -a $L; exit 1; }
  (cd $SJ/managed-agent-server && $MVN -B -ntp -q $R -Dmaven.test.skip=true -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true clean package) >> $L 2>&1; echo "[$A] server exit=$?" | tee -a $L
  local j=$SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
  cp $j $RIG/server/$A.jar
  echo "== $A.jar start=$(unzip -p $j META-INF/MANIFEST.MF | grep Start-Class | tr -d "\r" | sed "s/.*\.//") sha=$(shasum -a 256 $j | cut -c1-16) mig: $(unzip -l $j | grep -o 'db/migration/V[0-9]*__[a-zA-Z_]*' | sed 's#db/migration/##' | sort -V | tail -2 | tr '\n' ' ') activeHolds=$(unzip -p $j 'BOOT-INF/lib/qwen-managed-runtime-broker*.jar' > /tmp/rb$$.jar; unzip -p /tmp/rb$$.jar com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServer.class | grep -c -a 'active-holds'; rm -f /tmp/rb$$.jar)" | tee -a $L
}
restore() { (cd $W && git checkout HEAD -- packages/sdk-java && git clean -fdq -- packages/sdk-java/managed-agent-server/src packages/sdk-java/runtime-broker/src && echo "restore dirty=$(git status --short -- packages/sdk-java | wc -l)" | tee -a $L); }
: > $L
[ "${SKIP_PR:-0}" = 1 ] || build pr
(cd $W && git diff 950d757813 950d757813^1 -- packages/sdk-java/runtime-broker/src/main | git apply && echo "prefix applied: $(git diff --stat | tail -1)" | tee -a $L)
build prefix
restore
(cd $W && git diff HEAD $MAIN -- packages/sdk-java/runtime-broker/src/main packages/sdk-java/managed-agent-server/src/main | git apply && echo "base applied: $(git diff --stat | tail -1); vs main: $(git diff --name-only $MAIN -- packages/sdk-java | grep /src/main/ | wc -l) main-files differ" | tee -a $L)
build base
restore
echo "=== $(date +%T) JAR-DONE" | tee -a $L
