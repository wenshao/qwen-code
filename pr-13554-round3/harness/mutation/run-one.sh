#!/bin/bash
# usage: run-one.sh <ID|CONTROL>   (macOS host, JDK 21, offline, H2)
ID=$1; M=/Users/wenshao/pr13554-rig/mut; D=$M/work/$ID
/bin/rm -rf "$M/work/$ID"; cp -Rc $M/tree $D
MOD=$D/packages/sdk-java/managed-agent-server
if [ "$ID" != CONTROL ]; then for f in $M/mutants/$ID/*.java; do b=$(basename $f); cp $f $MOD/src/main/java/com/alibaba/qwen/code/managedagent/store/$b; done; fi
cd $MOD
JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH /Users/wenshao/Install/maven/bin/mvn -B -o \
  -Dmaven.repo.local=/Users/wenshao/pr13554-rig/m2-head -Dmaven.repo.local.tail=/Users/wenshao/.m2/repository \
  -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=SessionResourceCollectionCollectorTest -Dsurefire.failIfNoSpecifiedTests=false test > $M/logs/$ID.log 2>&1
echo "$ID exit=$?" >> $M/logs/$ID.log
cd $M && /bin/rm -rf "$M/work/$ID"
