#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/028f1664-c9a6-47d4-91b9-cc5a71282104/scratchpad
F="-Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false"
$SP/rig/it.sh mariadb-ws mariadb hosted-workspace-tools verify $F
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:$PATH
(cd $SP/wt-mut && mvn --batch-mode -q -Dmaven.repo.local=$SP/m2-mut -f packages/sdk-java/managed-agent-server/pom.xml clean test-compile > $SP/logs/mut-compile.log 2>&1; echo "wt-mut compile rc=$?")
: > $SP/results/mutants.txt
for spec in T1:prepared T2:running,status-unavailable,cancel-reply T3:status-unavailable,cancel-reply T4:status-unavailable,cancel-reply \
  T5a:status-unavailable,cancel-reply T5b:status-unavailable,cancel-reply T5c:status-unavailable,cancel-reply T6:status-unavailable,cancel-reply \
  T7:prepared,running,status-unavailable,cancel-reply P1:cancel-reply P2:status-unavailable W1:running,status-unavailable,cancel-reply; do
  $SP/rig/mutate.sh ${spec%%:*} ${spec#*:}
done
for spec in J1:running,status-unavailable,cancel-reply J2:prepared,running,status-unavailable,cancel-reply J3:prepared 'T3+J2:status-unavailable,cancel-reply'; do
  $SP/rig/mutate.sh "${spec%%:*}" ${spec#*:}
done
echo CHAIN1_DONE
