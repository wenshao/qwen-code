#!/bin/bash
# usage: build-arm.sh <arm> <worktree>  (runs inside the pr13554-rig container, offline)
set -u
ARM=$1; WT=$2
R=/Users/wenshao/pr13554-rig
L=$R/logs/build-$ARM; mkdir -p $L
REPO="-Dmaven.repo.local=$R/m2-$ARM -Dmaven.repo.local.tail=/m2tail"
S=$WT/packages/sdk-java
cd $S
mvn -B -q -o $REPO -f qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $L/qwencode.log 2>&1; echo "qwencode exit=$?" | tee -a $L/status
mvn -B -q -o $REPO -f runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install > $L/broker.log 2>&1; echo "broker exit=$?" | tee -a $L/status
cd $S/managed-agent-server
mvn -B -q -o $REPO -DskipTests -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true clean test-compile > $L/compile.log 2>&1; echo "compile exit=$?" | tee -a $L/status
mvn -B -q -o $REPO dependency:build-classpath -Dmdep.outputFile=$R/e2e/cp-$ARM.txt -Dmdep.includeScope=runtime > $L/cp.log 2>&1; echo "cp exit=$?" | tee -a $L/status
mvn -B -q -o $REPO dependency:build-classpath -Dmdep.outputFile=$R/e2e/cp-test-$ARM.txt -Dmdep.includeScope=test >> $L/cp.log 2>&1; echo "cp-test exit=$?" | tee -a $L/status
rm -rf $R/e2e/app-$ARM && mkdir -p $R/e2e/app-$ARM && cp -r target/classes $R/e2e/app-$ARM/classes && cp -r target/test-classes $R/e2e/app-$ARM/test-classes
(cd $R/e2e/app-$ARM/classes && find . -type f -name '*.class' | sort | xargs md5sum) > $R/e2e/app-$ARM.classes.md5
echo "BUILD-DONE $ARM $(date -u +%FT%TZ)" | tee -a $L/status
