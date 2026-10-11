#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 5, post-merge): after batch8, a real guest reboot on the landed squash 7cbb993c, then the full Broker and Server suites on it.
R=/Users/wenshao/pr13673-rig
until grep -q BATCH8-DONE $R/out/batch8.log; do sleep 15; done
$R/reboot.sh r5l-boot landed landed > $R/out/reboot-r5.log 2>&1; echo "REBOOT-DONE $(date -u +%T)"
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
SJ=/Users/wenshao/git/qwen-code-pr13673-landed/packages/sdk-java
(cd $SJ/runtime-broker && mvn -B -ntp -Dmaven.repo.local=$R/m2-landed -Dcheckstyle.skip=true -Dspotbugs.skip=true test > $R/out/broker-full-r5-landed.log 2>&1); echo "BROKER-FULL exit=$? $(grep -E 'Tests run:.*Fail' $R/out/broker-full-r5-landed.log | grep -v 'Time elapsed' | tail -1)"
(cd $SJ/managed-agent-server && mvn -B -ntp -Dmaven.repo.local=$R/m2-landed -Dcheckstyle.skip=true -Dspotbugs.skip=true test > $R/out/server-full-r5-landed.log 2>&1); echo "SERVER-FULL exit=$? $(grep -E 'Tests run:.*Fail' $R/out/server-full-r5-landed.log | grep -v 'Time elapsed' | tail -1)"
echo POST8-DONE $(date -u +%T)
