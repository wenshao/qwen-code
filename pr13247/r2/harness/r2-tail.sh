#!/bin/bash
set -u
RIG=/Users/wenshao/pr13247-rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
(cd $RIG/wt2m/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-r2m clean verify checkstyle:check > $RIG/out/r2m-verify-2.log 2>&1; echo "exit=$?" >> $RIG/out/r2m-verify-2.log)
echo "r2m verify rerun: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/r2m-verify-2.log | tail -1) $(tail -1 $RIG/out/r2m-verify-2.log)"
mkdir -p $RIG/r2/mutation; : > $RIG/r2/mutation/ledger.jsonl
cd $RIG/wt2-mut/packages/sdk-java/managed-agent-server
mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-r2mut -Dcheckstyle.skip -Dspotbugs.skip=true -Dtest=ManagedCwdChangeOperationTest,WorkspaceRuntimeInstallProbeTest,WorkspaceRuntimeResolutionPivotTest,ManagedAgentApiContractTest,ManagedOperationSchemaUpgradeTest,ManagedCwdOperationContractShapeTest,WorkspaceRuntimeTest -Dsurefire.failIfNoSpecifiedTests=false test > $RIG/r2/mutation/BASE.log 2>&1
echo "BASE exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/r2/mutation/BASE.log | tail -1)"
MUT_ARGS='["-Dcheckstyle.skip","-Dspotbugs.skip=true","-Dtest=ManagedCwdChangeOperationTest,WorkspaceRuntimeInstallProbeTest,WorkspaceRuntimeResolutionPivotTest,ManagedAgentApiContractTest,ManagedOperationSchemaUpgradeTest,ManagedCwdOperationContractShapeTest,WorkspaceRuntimeTest","-Dsurefire.failIfNoSpecifiedTests=false","test"]' MUT_TREE=$RIG/wt2-mut MUT_M2=$RIG/m2-r2mut $NODE $RIG/probe/mutate2.mjs
