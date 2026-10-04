#!/bin/bash
set -u
RIG=/Users/wenshao/pr13247-rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
FOC='["-Dcheckstyle.skip","-Dspotbugs.skip=true","-Dtest=ManagedCwdChangeOperationTest,WorkspaceRuntimeInstallProbeTest,WorkspaceRuntimeResolutionPivotTest,ManagedAgentApiContractTest,ManagedOperationSchemaUpgradeTest,ManagedCwdOperationContractShapeTest,WorkspaceRuntimeTest","-Dsurefire.failIfNoSpecifiedTests=false","test"]'
MUT_ARGS="$FOC" MUT_TREE=$RIG/wt2-mut MUT_M2=$RIG/m2-r2mut $NODE $RIG/probe/mutate2.mjs M10
MUT_SUFFIX=-full-unit MUT_ARGS='["-Dcheckstyle.skip","-Dspotbugs.skip=true","test"]' MUT_TREE=$RIG/wt2-mut MUT_M2=$RIG/m2-r2mut $NODE $RIG/probe/mutate2.mjs N5 N10 N11 N12 M15
MUT_SUFFIX=-hosted-it MUT_ARGS="[\"-Phosted-harness-mysql\",\"-Dit.test=HostedPublicWorkspaceIT\",\"-Dtest=NoSuchTest\",\"-Dsurefire.failIfNoSpecifiedTests=false\",\"-Dcheckstyle.skip\",\"-Dspotbugs.skip=true\",\"-Dnode.executable=$NODE\",\"-Dqwen.cli.entry=$RIG/dist/head2/cli.js\",\"verify\"]" MUT_TREE=$RIG/wt2-mut MUT_M2=$RIG/m2-r2mut $NODE $RIG/probe/mutate2.mjs N5 N10 N11 N12 M15
