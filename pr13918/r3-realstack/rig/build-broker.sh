#!/bin/bash
# usage: build-broker.sh <arm> — qwencode + runtime-broker install into m2-<arm> (no server jar)
A=$1; RIG=/Users/wenshao/pr13918-rig; SJ=$RIG/src-$A/packages/sdk-java; L=$RIG/out/broker-$A.log; M2=$RIG/m2-$A
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH; MVN=/Users/wenshao/Install/maven/bin/mvn
[ -d $M2 ] || { cp -Rc ~/.m2/repository $M2 && rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker $M2/com/alibaba/qwen-managed-agent-server; }
echo "=== $(date +%T) $A ($(git -C $SJ rev-parse --short HEAD))" > $L
(cd $SJ/qwencode && $MVN -B -ntp -q -Dmaven.repo.local=$M2 -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) >> $L 2>&1; echo "qwencode exit=$?" >> $L
(cd $SJ/runtime-broker && $MVN -B -ntp -q -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install) >> $L 2>&1; echo "broker exit=$?" >> $L
echo "BROKER-DONE" >> $L
