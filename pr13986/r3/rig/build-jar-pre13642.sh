#!/bin/bash
# Server jar at main 91385884eb (after #14069, before #13642's in-place V1 edit).
set -u
RIG=/Users/wenshao/pr13986-rig; SJ=$RIG/src-pre13642/packages/sdk-java; L=$RIG/out/build-jar-pre13642.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn; R="-Dmaven.repo.local=$RIG/m2"
: > $L
(cd $SJ/qwencode && $MVN -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) >> $L 2>&1; echo "qwencode exit=$?" | tee -a $L
(cd $SJ/runtime-broker && $MVN -B -ntp -q $R -Dmaven.test.skip=true -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true clean install) >> $L 2>&1; rc=$?; echo "broker exit=$rc" | tee -a $L; [ $rc = 0 ] || exit 1
(cd $SJ/managed-agent-server && $MVN -B -ntp -q $R -Dmaven.test.skip=true -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dgpg.skip=true clean package) >> $L 2>&1; echo "server exit=$?" | tee -a $L
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $RIG/server/pre13642.jar && echo "jar ok $(shasum -a 256 $RIG/server/pre13642.jar | cut -c1-16)" | tee -a $L
