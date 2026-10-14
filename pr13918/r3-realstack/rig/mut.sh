#!/bin/bash
# usage: mut.sh <label>  — runs the v2-fence unit classes in src-r3mut (H2) against m2-r3
RIG=/Users/wenshao/pr13918-rig; L=$RIG/out/mut-$1.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd $RIG/src-r3mut/packages/sdk-java/managed-agent-server
echo "=== $(date +%T) $1 diff:" > $L; git diff --stat >> $L; git diff >> $L
/Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-r3 -Dcheckstyle.skip=true -Dspotbugs.skip=true \
  -Dtest="${TESTS:-SessionLifecycleCoordinatorTest,WorkspaceLifecycleStoreTest,WorkspaceProfileLifecycleTest}" -Dsurefire.failIfNoSpecifiedTests=false test >> $L 2>&1
echo "[$1] EXIT=$?" >> $L
grep -E "Tests run:.*Fail|FAILURE|ERROR\]" $L | grep -v "^\[ERROR\] *$" | tail -12
