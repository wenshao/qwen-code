#!/bin/bash
cd /Users/wenshao/pr13621-rig/src-h3/packages/sdk-java/managed-agent-server
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
M="/Users/wenshao/Install/maven/bin/mvn -B -ntp -q -o -Dmaven.repo.local=/Users/wenshao/pr13621-rig/m2-h3"
O=/Users/wenshao/pr13621-rig/out
rm -rf target/surefire-reports
$M -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest='ReplayFloor*Test,ManagedEventReplayTest,Issue13181QueryBudgetTest' -Dsurefire.failIfNoSpecifiedTests=false test > $O/h3-unit.log 2>&1; echo unit-exit=$?
grep -h "Tests run" target/surefire-reports/*.txt
$M checkstyle:check > $O/h3-checkstyle.log 2>&1; echo checkstyle-exit=$?
F=src/main/java/com/alibaba/qwen/code/managedagent/service/ReplayFloorAdvancer.java
cp $F /tmp/RFA3.bak.$$
sed -i '' 's/@Scheduled(scheduler = "replayFloorScheduler", fixedDelayString =/@Scheduled(fixedDelayString =/' $F; grep -n "@Scheduled" $F
rm -rf target/surefire-reports
$M -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest='ReplayFloorSchedulerTest' -Dsurefire.failIfNoSpecifiedTests=false test > $O/h3-mutant.log 2>&1; echo mutant-exit=$?
grep -h "Tests run\|expected" target/surefire-reports/*SchedulerTest.txt | head -3
cp /tmp/RFA3.bak.$$ $F; rm /tmp/RFA3.bak.$$
cd /Users/wenshao/pr13621-rig/src-h3 && git status --short | grep -v "^??" | head; git diff --quiet && echo tree-clean
