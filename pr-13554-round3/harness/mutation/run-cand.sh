#!/bin/bash
# usage: run-cand.sh <ID|CONTROL>: same as run-one.sh plus the candidate test file
ID=$1; M=/Users/wenshao/pr13554-rig/mut; D=$M/work/cand-$ID
/bin/rm -rf "$M/work/cand-$ID"; cp -Rc $M/tree $D
MOD=$D/packages/sdk-java/managed-agent-server
cp $M/candidate/SessionResourceCollectionCollectorTest.java $MOD/src/test/java/com/alibaba/qwen/code/managedagent/store/
if [ "$ID" != CONTROL ]; then for f in $M/mutants/$ID/*.java; do cp $f $MOD/src/main/java/com/alibaba/qwen/code/managedagent/store/$(basename $f); done; fi
cd $MOD
JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH /Users/wenshao/Install/maven/bin/mvn -B -o \
  -Dmaven.repo.local=/Users/wenshao/pr13554-rig/m2-head -Dmaven.repo.local.tail=/Users/wenshao/.m2/repository \
  -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=SessionResourceCollectionCollectorTest -Dsurefire.failIfNoSpecifiedTests=false test > $M/logs/cand-$ID.log 2>&1
echo "cand-$ID exit=$?" >> $M/logs/cand-$ID.log
cd $M && /bin/rm -rf "$M/work/cand-$ID"
