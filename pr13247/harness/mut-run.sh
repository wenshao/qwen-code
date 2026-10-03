#!/bin/bash
# VERIFICATION RIG ONLY: baseline + mutants for PR #13247 (sequential).
set -u
RIG=/Users/wenshao/pr13247-rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
mkdir -p $RIG/results/mutation; : > $RIG/results/mutation/ledger.jsonl
cd $RIG/wt-mut/packages/sdk-java/managed-agent-server
mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-mut -Dcheckstyle.skip -Dtest=ManagedCwdChangeOperationTest,WorkspaceRuntimeInstallProbeTest,WorkspaceRuntimeResolutionPivotTest,ManagedAgentApiContractTest,ManagedOperationSchemaUpgradeTest -Dsurefire.failIfNoSpecifiedTests=false test > $RIG/results/mutation/BASE.log 2>&1
echo "BASE exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/results/mutation/BASE.log | tail -1)"
MUT_TREE=$RIG/wt-mut MUT_M2=$RIG/m2-mut $NODE $RIG/probe/mutate.mjs "$@"
