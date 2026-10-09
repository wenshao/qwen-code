#!/bin/bash
# usage: repeat.sh <ID|CONTROL> <testMethod> <n>
ID=$1; T=$2; N=$3; M=/Users/wenshao/pr13554-rig/mut4; D=$M/work/rep-$ID
/bin/rm -rf "$M/work/rep-$ID"; cp -Rc $M/tree $D
MOD=$D/packages/sdk-java/managed-agent-server
if [ "$ID" != CONTROL ]; then for f in $M/mutants/$ID/*.java; do cp $f $MOD/src/main/java/com/alibaba/qwen/code/managedagent/store/$(basename $f); done; fi
cd $MOD
for i in $(seq 1 $N); do
  JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH /Users/wenshao/Install/maven/bin/mvn -B -o \
    -Dmaven.repo.local=/Users/wenshao/pr13554-rig/m2-h4 -Dmaven.repo.local.tail=/Users/wenshao/.m2/repository \
    -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true "-Dtest=SessionResourceCollectionCollectorTest#$T" \
    -Dsurefire.failIfNoSpecifiedTests=false test > $M/logs/rep-$ID-$i.log 2>&1
  echo "$ID run $i: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $M/logs/rep-$ID-$i.log | tail -1 | sed 's/.*Tests run/Tests run/') $(grep -m1 -oE 'expected: .{0,80}' $M/logs/rep-$ID-$i.log)"
done | tee $M/logs/rep-$ID.summary
cd $M && /bin/rm -rf "$M/work/rep-$ID"
