#!/bin/bash
# VERIFICATION RIG ONLY: PR head 697d38a3 on its own base (e263741e), own Maven repo.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
cd $S/wt-pr || exit 1
export JAVA_HOME=$HOME/Install/jdk21 PATH=$HOME/Install/jdk21/bin:$HOME/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -o -s $S/m2settings.xml -Dmaven.repo.local=$S/m2repo-pr"
echo "wt-pr HEAD=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ')"
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -Dcheckstyle.skip -Dtest=HarnessCoordinatorTest -Dsurefire.failIfNoSpecifiedTests=false test > $S/logs/pr-head2-coordinator.log 2>&1; echo "coordinator test rc=$?"
grep -E "Tests run:|BUILD" $S/logs/pr-head2-coordinator.log | tail -3
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml checkstyle:check > $S/logs/pr-head2-checkstyle.log 2>&1; echo "checkstyle rc=$?"
grep -E "BUILD|violation" $S/logs/pr-head2-checkstyle.log | tail -3
echo "wt-pr HEAD=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ')"
