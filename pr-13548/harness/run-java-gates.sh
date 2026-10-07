#!/bin/bash
ARM=$1
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/maven/bin:$PATH
M2="-Dmaven.repo.local=/root/verify/pr13548/m2-$ARM -Dmaven.repo.local.tail=/root/.m2/repository"
cd /root/verify/pr13548/$ARM/packages/sdk-java/managed-agent-server
mvn -o $M2 -q -Djacoco.skip=true dependency:build-classpath -Dmdep.outputFile=/root/verify/pr13548/cp-$ARM.txt -Dmdep.includeScope=test && echo CP_OK
mvn -o $M2 -Djacoco.skip=true -Dsurefire.failIfNoSpecifiedTests=false test -Dtest='ManagedChannelRecordContractTest,ManagedExtensionProjectionContractTest,ManagedExtensionRecordStoreTest,ManagedMcpRecordContractTest,ManagedHookRecordContractTest,ManagedChildRunRecordContractTest,ManagedMonitorRecordContractTest,PlannedChannelContractTest,ManagedAgentApiContractTest'
