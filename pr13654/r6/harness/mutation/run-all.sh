#!/bin/bash
# usage: run-all.sh M5 M6   each mutant: apply, run every ToolPublication* unit test class + Issue13181QueryBudgetTest, restore.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; W=$HOME/git/qwen-code-pr13654
D=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store
cd $W || exit 1; [ "$(git rev-parse HEAD)" = 296b1be5da597a62a3527782a59687a8568d23bc ] || { echo "worktree not at head"; exit 1; }
for m in "$@"; do
  git checkout -q -- $D; python3 $S/r6/mut/mutate.py $W $m || continue
  $S/rig/mvn.sh -f packages/sdk-java/managed-agent-server/pom.xml -Dtest='ToolPublication*,Issue13181QueryBudgetTest' \
    -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true test > $S/r6/mut/mvn-all-$m.log 2>&1
  echo "$m mvn exit=$?"
  rm -rf $S/r6/mut/reports-all-$m; mkdir -p $S/r6/mut/reports-all-$m; cp packages/sdk-java/managed-agent-server/target/surefire-reports/TEST-*.xml $S/r6/mut/reports-all-$m/
  python3 $S/r5/summ-total.py $S/r6/mut/reports-all-$m | head -3
  python3 $S/r6/probe/summ.py $S/r6/mut/reports-all-$m | grep -v '^   ' | sed 's/^/   /'
  git checkout -q -- $D; echo "restored: $(git status --porcelain | wc -l | tr -d ' ') dirty; DataStore $(git hash-object $D/ToolPublicationDataStore.java | cut -c1-8)"
done
