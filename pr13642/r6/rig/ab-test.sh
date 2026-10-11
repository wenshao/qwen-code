#!/bin/bash
# usage: ab-test.sh <arm-worktree> <m2> <TestClass> <runs> <tag>   (H2 unit test class only)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
WT=$S/wt-$1; REPO=$S/m2-$2; TC=$3; N=$4; TAG=$5
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$REPO"
cd $WT; echo "arm=$1 commit=$(git rev-parse --short HEAD)"
if [ "${PREP:-}" = 1 ]; then
  $MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $S/ab-$TAG-prep.log 2>&1 || { echo prep-qwencode-failed; exit 1; }
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true clean install >> $S/ab-$TAG-prep.log 2>&1 || { echo prep-broker-failed; exit 1; }
fi
for i in $(seq 1 $N); do
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dspotbugs.skip=true -Dcheckstyle.skip=true test -Dtest=$TC -Dsurefire.failIfNoSpecifiedTests=false > $S/ab-$TAG-$i.log 2>&1
  echo "run $i: $(grep -E 'Tests run: [0-9]+, Fail' $S/ab-$TAG-$i.log | grep -v ' in ' | tail -1) $(grep -o -E '^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+:[0-9]+' $S/ab-$TAG-$i.log | sed 's/\[ERROR\]   //' | sort | uniq -c | tr '\n' ' ')"
done
echo "ab done"
