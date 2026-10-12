#!/bin/bash
# Round 7: local trial merge 74bab6a5 = PR head 876b00ef + main e9789d09 (no conflicts, never pushed).
# Its sdk-java differs from round 6's verified trial merge b8203960 only by main aaf97b86's four added files,
# so this runs the managed-agent-server module verify (unit tests + checkstyle + spotbugs, no MySQL ITs) like round 6.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; R=$S/rig; W=$HOME/git/qwen-code-pr13654-main; M=$R/mvn-main6.sh
L=$S/r7/logs; mkdir -p $L
cd $W || exit 1
[ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
git checkout -q --detach 74bab6a50fce22a8cea1ebb08403d4ed99e4c675 || exit 1
echo "trial merge at $(git rev-parse --short HEAD) parents $(git log -1 --format=%p) $(date +%T)"
$M -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q > $L/trial-deps.log 2>&1 && \
$M -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q >> $L/trial-deps.log 2>&1 || { echo "deps FAILED"; exit 1; }
cd packages/sdk-java/managed-agent-server
$M -Dmaven.test.failure.ignore=true clean verify checkstyle:check > $L/trial-verify.log 2>&1; echo "mvn exit=$? $(date +%T)"
rm -rf $S/r7/reports-trial; mkdir -p $S/r7/reports-trial; cp target/surefire-reports/TEST-*.xml $S/r7/reports-trial/ 2>/dev/null
python3 $S/r5/summ-total.py $S/r7/reports-trial
grep -E 'You have [0-9]+ Checkstyle|BugInstance size|Total bugs|BUILD|ERROR\] Failed' $L/trial-verify.log | tail -6
cd $W && git checkout -q --detach b8203960e5 && echo "restored $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
