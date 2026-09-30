#!/bin/bash
# VERIFICATION RIG ONLY (PR #13117): baseline + mutants in one worktree, restoring after each.
# usage: lane.sh <worktree> <m2-label> <arm> <mutant ids...>
RIG=/Users/wenshao/pr13117-rig; WT=$1; M2=$2; ARM=$3; shift 3
W='ManagedAgentApiContractTest,TenantContextFilterTest,ApiExceptionHandlerTest,ManagedActionsTest,ManagedSessionLifecycleTest,ManagedTurnQueryTest,ManagedWorkspaceAdmissionTest,PlannedTaskContractTest,ManagedSessionStoreContractFixtureTest,ManagedAgentServerIntegrationTest,ManagedSessionStoreIntegrationTest,ManagedEventReplayTest,ManagedMcpCatalogContractTest'
cd $RIG/$WT || exit 1
[ -z "$(git status --porcelain -- packages)" ] || { echo "DIRTY $WT"; exit 1; }
$RIG/runtests.sh $WT $M2 $ARM-base "$W"
for m in "$@"; do
  node $RIG/mut.mjs $RIG/$WT $m || { echo "RESULT $ARM-$m APPLY-FAILED"; continue; }
  git diff --stat -- packages | tail -1 > $RIG/out/tests/.stat
  $RIG/runtests.sh $WT $M2 $ARM-$m "$W"
  mkdir -p $RIG/out/tests/$ARM-$m && git diff -- packages > $RIG/out/tests/$ARM-$m/mutant.diff
  git checkout -- packages/sdk-java/managed-agent-server/src
  [ -z "$(git status --porcelain -- packages)" ] || { echo "RESTORE FAILED after $m"; exit 1; }
done
echo "LANE-DONE $ARM"
