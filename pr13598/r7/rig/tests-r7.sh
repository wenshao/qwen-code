#!/bin/bash
# Round 7 tests at the head worktree (66af9bc185): TS Harness files, core automation + the two CI-red core tests,
# and the full managed-agent-server Java module. Sequential so no two vitest runs share a coverage temp dir.
WT=/Users/wenshao/git/pr13598-head; R=/Users/wenshao/git/pr13598-rig; OUT=$R/results/r7/tests-raw; mkdir -p $OUT
cd $WT/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-harness-session.test.ts \
  src/serve/hosted-monitor-wake.test.ts src/serve/hosted-runtime-recovery.test.ts src/serve/hosted-workspace-broker.test.ts \
  src/serve/managed-automation-operations.test.ts > $OUT/ts-cli.log 2>&1; echo "TS-CLI EXIT $?" >> $OUT/ts-cli.log
cd $WT/packages/core && npx vitest run src/managed-runtime/managed-automation-record.test.ts src/managed-runtime/managed-automation-slots.test.ts \
  src/managed-runtime/managed-session-authority.automation.test.ts src/managed-runtime/managed-session-authority.extension.test.ts \
  src/managed-runtime/managed-session-metadata.test.ts > $OUT/ts-core.log 2>&1; echo "TS-CORE EXIT $?" >> $OUT/ts-core.log
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:$PATH
cd $WT/packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$R/m2-head -Dcheckstyle.skip -Dspotless.check.skip=true test > $OUT/java.log 2>&1; echo "JAVA EXIT $?" >> $OUT/java.log
echo "TESTS-DONE $(date +%T)" >> $OUT/java.log
