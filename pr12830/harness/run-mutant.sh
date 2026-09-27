#!/bin/bash
# run-mutant.sh <name> <apply-script>   (runs in the pr12830-mut worktree, restores afterwards)
S=$SCRATCH
W=$MUT_WORKTREE; MAS=$W/packages/sdk-java/managed-agent-server
N=$1; A=$2
export JAVA_HOME=$JDK21 PATH=$JDK21/bin:$PATH
cd $W && git diff --quiet && [ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 2; }
bash $A $W || { echo "apply failed"; exit 2; }
git -C $W diff --stat | tail -1; git -C $W status --porcelain | grep '^??'
cd $MAS && mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2/repository -Dtest=${TESTS:-ManagedAgentApiContractTest} -Dsurefire.failIfNoSpecifiedTests=false test > $S/mut/$N.log 2>&1
rc=$?
R=$(grep -E "Tests run: [0-9]+, Failures" $S/mut/$N.log | tail -1)
echo "$N rc=$rc :: $R"
grep -E "^\s+\+ |^\s+- (route|record|request|response)" $S/mut/$N.log | sort -u | head -12
cd $W && git checkout -q -- . && git clean -fdq -- packages/sdk-java/managed-agent-server/src
