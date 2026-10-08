#!/bin/bash
# usage: run-tests.sh <arm> <label> <-Dtest pattern> [extra mvn args]
A=$1; LBL=$2; T=$3; shift 3
RIG=/Users/wenshao/pr13544-rig; W=$RIG/src-$A/packages/sdk-java/managed-agent-server; L=$RIG/out/test-$A-$LBL.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
echo "=== $(date +%T) $A $LBL ($(git -C $RIG/src-$A rev-parse --short HEAD)) tests=$T" > $L
(cd $W && /Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-$A -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dsurefire.failIfNoSpecifiedTests=false "-Dtest=$T" "$@" test) >> $L 2>&1
echo "[$A $LBL] exit=$?" >> $L
grep -E 'Tests run:.*Fail|ERROR\]   |FAIL' $L | tail -40 > $RIG/out/test-$A-$LBL.summary
echo "=== $(date +%T) TEST-DONE" >> $L
