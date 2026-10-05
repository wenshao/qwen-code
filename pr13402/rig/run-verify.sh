#!/bin/bash
# Usage: run-verify.sh <arm>  — full managed-agent-server `mvn verify` (unit suite + checkstyle + spotbugs), JDK 21
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad
ARM=$1
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
M2=$S/m2/$ARM
[ -d $M2 ] || cp -Rc $S/m2/seed $M2
cd $S/wt-$ARM/packages/sdk-java || exit 2
LOG=$S/logs/verify-$ARM.log; : > $LOG
echo "arm=$ARM head=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)" >> $LOG
if [ "$ARM" = head ]; then
  for m in qwencode runtime-broker; do
    mvn -B -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dgpg.skip -Dmaven.javadoc.skip -Dmaven.source.skip -f $m/pom.xml clean install >> $LOG 2>&1 || { echo "$ARM $m INSTALL-FAIL"; exit 1; }
  done
fi
t0=$(date +%s)
mvn -B -Dmaven.repo.local=$M2 -Dgpg.skip -f managed-agent-server/pom.xml clean verify >> $LOG 2>&1
rc=$?; t1=$(date +%s)
echo "exit=$rc wall=$((t1-t0))s" >> $LOG
echo "$ARM verify exit=$rc wall=$((t1-t0))s | $(grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $LOG | tail -1 | sed 's/.*Tests run/Tests run/') | $(grep -a -o -E 'You have [0-9]+ Checkstyle violations|BugInstance size is [0-9]+|Total bugs: [0-9]+' $LOG | tail -2 | tr '\n' ' ') | $(grep -a -c 'SessionEventHub' $LOG) hub lines"
