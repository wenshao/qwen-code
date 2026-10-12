#!/bin/bash
# usage: run.sh M1 M2 ...   each mutant: apply, run the PR's async + store tests and the round-6 H2 probes, restore.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; P=$S/r6/probe; W=${W:-$HOME/git/qwen-code-pr13654}
D=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store
cd $W || exit 1; [ "$(git rev-parse HEAD)" = 296b1be5da597a62a3527782a59687a8568d23bc ] || { echo "worktree not at head"; exit 1; }
for m in "$@"; do
  git checkout -q -- $D; python3 $S/r6/mut/mutate.py $W $m || { echo "$m: not applied"; continue; }
  git diff --stat -- $D | tail -1
  $P/install.sh $W > /dev/null
  $S/rig/mvn.sh -f packages/sdk-java/managed-agent-server/pom.xml \
    -Dtest="ToolPublicationAsyncVerificationTest,ToolPublicationStoreTest,RigR6ProbeTest#probeO*+probeOT*+probeC_r*+probeU*+probeB1*+probeB_r*+probeS_*" \
    -Dsurefire.failIfNoSpecifiedTests=false -Dprobe.out=$S/r6/mut/probe-$m.txt -Dprobe.arm=$m \
    -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true test > $S/r6/mut/mvn-$m.log 2>&1
  echo "$m mvn exit=$?"
  rm -f $W/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store/RigR6Probe*.java
  rm -rf $S/r6/mut/reports-$m; mkdir -p $S/r6/mut/reports-$m; cp packages/sdk-java/managed-agent-server/target/surefire-reports/TEST-*.xml $S/r6/mut/reports-$m/ 2>/dev/null
  python3 $P/summ.py $S/r6/mut/reports-$m | grep -v '^   ' ; python3 $P/summ.py $S/r6/mut/reports-$m | grep '^   ' | grep -v RigR6 | cut -c1-200 | head -12
  git checkout -q -- $D; echo "restored: $(git status --porcelain | wc -l | tr -d ' ') dirty; DataStore $(git hash-object $D/ToolPublicationDataStore.java | cut -c1-8) Store $(git hash-object $D/ToolPublicationStore.java | cut -c1-8)"
done
