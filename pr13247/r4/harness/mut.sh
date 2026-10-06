#!/bin/bash
set -u
RIG=/Users/wenshao/pr13247-rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
while pgrep -f "r4/r4-java.sh" >/dev/null; do sleep 15; done
mkdir -p $RIG/r4/mutation; : > $RIG/r4/mutation/ledger.jsonl
T=ManagedCwdChangeOperationTest,WorkspaceRuntimeInstallProbeTest,WorkspaceRuntimeResolutionPivotTest,ManagedAgentApiContractTest,ManagedOperationSchemaUpgradeTest,ManagedCwdOperationContractShapeTest,WorkspaceRuntimeTest
cd $RIG/wt4-mut/packages/sdk-java/managed-agent-server
mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-r4mut -Dcheckstyle.skip -Dspotbugs.skip=true -Dtest=$T -Dsurefire.failIfNoSpecifiedTests=false test > $RIG/r4/mutation/BASE.log 2>&1
echo "BASE exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/r4/mutation/BASE.log | tail -1)"
MUT_ARGS="[\"-Dcheckstyle.skip\",\"-Dspotbugs.skip=true\",\"-Dtest=$T\",\"-Dsurefire.failIfNoSpecifiedTests=false\",\"test\"]" MUT_TREE=$RIG/wt4-mut MUT_M2=$RIG/m2-r4mut $NODE $RIG/probe/mutate4.mjs
