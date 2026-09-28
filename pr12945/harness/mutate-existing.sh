#!/bin/bash
# usage: mutate-existing.sh <ID...> -- bundle mutant vs the pre-existing Workspace IT (no provisioning delay)
SP=${SP:?set SP to the scratch directory}
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
for ID in "$@"; do
  node $SP/rig/apply-mutant.cjs $SP/wt-mut $ID || continue
  WT=wt-mut $SP/rig/it.sh exist-$ID mysql hosted-workspace-tools -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip=true \
    '-Dit.test=HostedWorkspaceToolTurnIT#packagedHarnessUsesSavedWorkspacesThroughRealBrokerWorkerAndSqlStore' verify > /dev/null 2>&1
  RC=$?
  echo "EXISTING-IT $ID exit=$RC -> $([ $RC = 0 ] && echo SURVIVED || echo KILLED) $(grep -h -o -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+' $SP/logs/it-exist-$ID.log | tail -1)"
  [ $RC = 0 ] || grep -h -o -E "AssertionError[^\"]{0,140}" $SP/logs/it-exist-$ID.log | sort | uniq -c | head -3
done
node $SP/rig/apply-mutant.cjs $SP/wt-mut none
