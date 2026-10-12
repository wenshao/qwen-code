#!/bin/bash
# Round 6: local trial merge b8203960 = PR head 296b1be5 + main b1b2b2c6 (ManagedAgentProperties conflict: both sides kept).
# Installs the trial merge's qwencode + runtime-broker into m2-main6, then runs the managed-agent-server module verify
# (unit tests + checkstyle + spotbugs; no MySQL ITs) the way CI's Java jobs do.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; R=$S/rig; W=$HOME/git/qwen-code-pr13654-main; M=$R/mvn-main6.sh
cd $W || exit 1; echo "trial merge at $(git rev-parse --short HEAD) parents $(git log -1 --format=%p) $(date +%T)"
$M -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q > $S/r6/logs/trial-deps.log 2>&1 && \
$M -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q >> $S/r6/logs/trial-deps.log 2>&1 || { echo "deps FAILED"; exit 1; }
cd packages/sdk-java/managed-agent-server
$M -Dmaven.test.failure.ignore=true clean verify checkstyle:check > $S/r6/logs/trial-verify.log 2>&1; echo "mvn exit=$? $(date +%T)"
rm -rf $S/r6/reports-trial; mkdir -p $S/r6/reports-trial; cp target/surefire-reports/TEST-*.xml $S/r6/reports-trial/ 2>/dev/null
python3 $S/r5/summ-total.py $S/r6/reports-trial
grep -E 'You have [0-9]+ Checkstyle|BugInstance size|Total bugs|BUILD|ERROR\] Failed' $S/r6/logs/trial-verify.log | tail -6
