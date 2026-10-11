#!/bin/bash
# Round 4: PR-touched + neighbouring Java test classes on one arm.
A=${1:-h5}; RIG=/Users/wenshao/pr13674-rig; SJ=$RIG/src-$A/packages/sdk-java
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn; R="-Dmaven.repo.local=$RIG/m2-$A"
CL=SurfaceAdmissionAcceptanceTest,ManagedCwdChangeOperationTest,ManagedWorkspaceAdmissionTest,ManagedAgentPropertiesTest,Issue13180HardenedVerificationTest,ManagedAgentApiContractTest,WorkspaceSessionRetentionTest,QwenHostedHarnessConnectorTest,ManagedActionsTest,SessionLifecycleCoordinatorTest,ChildResultRelayTest,ManagedTaskCancelOperationTest,ManagedAgentDefinitionAdmissionTest,AgentDefinitionCompilerTest
echo "=== $(date +%T) server tests $A"
(cd $SJ/managed-agent-server && $MVN -B -ntp $R -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dsurefire.failIfNoSpecifiedTests=false -Dtest="$CL" test) 2>&1 | grep -E 'Tests run:|FAIL|ERROR\]|BUILD' | grep -v 'Tests run: [0-9]*, Failures: 0, Errors: 0, Skipped: 0, Time' ; echo "server exit=${PIPESTATUS[0]}"
echo "=== $(date +%T) sdk tests $A"
(cd $SJ/qwencode && $MVN -B -ntp $R -Dsurefire.failIfNoSpecifiedTests=false -Dtest='HostedAgentDefinitionRequestTest,*HarnessSession*Test,HostedHarnessClient*Test' test) 2>&1 | grep -E 'Tests run:|FAIL|ERROR\]|BUILD' ; echo "sdk exit=${PIPESTATUS[0]}"
echo "=== $(date +%T) JAVA-TESTS-DONE"
