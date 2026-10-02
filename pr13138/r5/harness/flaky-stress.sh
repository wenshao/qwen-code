#!/bin/bash
# container (VM, Java 21 + Maven): run one test method N times per tree.  usage: flaky-loop.sh N <tree>:<label> ...
set -u
N=$1; shift
O=/rig/out/flaky-stress; mkdir -p $O
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
T='ManagedEventReplayTest#expiredCursorsGetConflictOrOneResyncFrame'
for spec in "$@"; do
  TREE=${spec%%:*}; L=${spec#*:}; W=/f-$L; SJ=$W/packages/sdk-java
  rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
  (cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L-setup.log 2>&1)
  (cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install >> $O/$L-setup.log 2>&1)
  (cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true test-compile >> $O/$L-setup.log 2>&1)
  for k in 1 2 3 4 5 6; do (while :; do :; done) & done
  pass=0; fail=0; cme=0
  for i in $(seq 1 $N); do
    (cd $SJ/managed-agent-server && mvn -B -ntp -o $R -Dcheckstyle.skip=true -Dtest="$T" -Dsurefire.failIfNoSpecifiedTests=false surefire:test > $O/$L-$i.log 2>&1)
    if grep -q "Tests run: 1, Failures: 0, Errors: 0" $O/$L-$i.log; then pass=$((pass+1)); rm -f $O/$L-$i.log; else fail=$((fail+1)); grep -q ConcurrentModificationException $O/$L-$i.log && cme=$((cme+1)); fi
  done
  kill $(jobs -p) 2>/dev/null
  echo "[$L] (6 busy loops on 4 vCPU) runs=$N pass=$pass fail=$fail of_which_CME=$cme"
  rm -rf $W
done
echo FLAKY-DONE
