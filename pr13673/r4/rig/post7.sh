#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 4): after batch7, a real guest reboot on the trial merge, then the full Broker and Server suites on it.
R=/Users/wenshao/pr13673-rig
until grep -q BATCH7-DONE $R/out/batch7.log; do sleep 15; done
$R/reboot.sh r4m-boot merge3 merge3 > $R/out/reboot-r4.log 2>&1; echo "REBOOT-DONE $(date -u +%T)"
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
SJ=/Users/wenshao/git/qwen-code-pr13673-merge3/packages/sdk-java
(cd $SJ/runtime-broker && mvn -B -ntp -Dmaven.repo.local=$R/m2-merge3 -Dcheckstyle.skip=true -Dspotbugs.skip=true test > $R/out/broker-full-r4-merge.log 2>&1); echo "BROKER-FULL exit=$? $(grep -E 'Tests run:.*Fail' $R/out/broker-full-r4-merge.log | grep -v 'Time elapsed' | tail -1)"
(cd $SJ/managed-agent-server && mvn -B -ntp -Dmaven.repo.local=$R/m2-merge3 -Dcheckstyle.skip=true -Dspotbugs.skip=true test > $R/out/server-full-r4-merge.log 2>&1); echo "SERVER-FULL exit=$? $(grep -E 'Tests run:.*Fail' $R/out/server-full-r4-merge.log | grep -v 'Time elapsed' | tail -1)"
echo POST7-DONE $(date -u +%T)
