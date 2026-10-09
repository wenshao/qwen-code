#!/bin/bash
# Round 7: each failure from tests-r7.sh re-run alone (sequential), plus the core automation-operations file.
WT=/Users/wenshao/git/pr13598-head; R=/Users/wenshao/git/pr13598-rig; OUT=$R/results/r7/tests-raw/rerun.log; : > $OUT
cd $WT/packages/cli
npx vitest run src/serve/hosted-harness-session.test.ts -t "completes an answer \(chunked\) and clears file history after a recovered Write continuation" 2>&1 | grep -E "Tests  |✓|×" | tail -3 | sed 's/^/[cli chunked] /' >> $OUT
npx vitest run src/serve/hosted-monitor-wake.test.ts -t "settles a notification that landed beyond the default event page" 2>&1 | grep -E "Tests  |✓|×" | tail -3 | sed 's/^/[cli monitor-page] /' >> $OUT
cd $WT/packages/core
npx vitest run src/managed-runtime/managed-automation-slots.test.ts 2>&1 | grep -E "Tests  |×" | tail -3 | sed 's/^/[core slots] /' >> $OUT
ls src/managed-runtime/managed-automation-operations.test.ts src/*/managed-automation-operations.test.ts 2>/dev/null | head -1 > /tmp/mao-$$.txt
F=$(cat /tmp/mao-$$.txt); rm -f /tmp/mao-$$.txt
[ -n "$F" ] && npx vitest run $F 2>&1 | grep -E "Tests  |×" | tail -3 | sed "s|^|[core $F] |" >> $OUT
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:$PATH
cd $WT/packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$R/m2-head -Dcheckstyle.skip -Dspotless.check.skip=true -Dtest=RuntimeBrokerFlywaySchemaTest -Dsurefire.failIfNoSpecifiedTests=false test 2>&1 | grep -E "Tests run:|BUILD" | tail -3 | sed 's/^/[java flyway-schema] /' >> $OUT
echo "RERUN-DONE $(date +%T)" >> $OUT
