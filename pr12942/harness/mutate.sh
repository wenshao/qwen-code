#!/bin/bash
# usage: mutate.sh <mutant> [db] [extra maven args]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9a095a26-d8c9-4266-9a4d-4dda027df21c/scratchpad
NAME=$1; DBK=${2:-mysql}; shift 2
node $SP/rig/mutants.cjs apply "$NAME" || exit 2
LABEL=mut-$NAME-$DBK${TAG:+-$TAG}
M2=m2 WT=${WT:-wt-mut} $SP/rig/it.sh $LABEL $DBK hosted-workspace-tools clean verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
  '-Dit.test=HostedWorkspaceToolTurnIT#disconnectedObserversResumeWithoutReplayingTheToolOnMySql' "$@" > /dev/null 2>&1
RC=$?
L=$SP/logs/it-$LABEL.log
HITS=$(grep -rla "RIG_MUTANT_$NAME" $SP/${WT:-wt-mut}/packages/sdk-java/managed-agent-server/target/classes | wc -l | tr -d ' ')
node $SP/rig/mutants.cjs restore "$NAME"
echo "$NAME${TAG:+[$TAG]} db=$DBK exit=$RC classHits=$HITS ok=$(grep -c '^HOSTED_SSE_GAP_OK' $L) | $(node $SP/rig/why.cjs $L)" | tee -a $SP/results/mutants.txt
