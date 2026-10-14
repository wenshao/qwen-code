#!/bin/bash
cd /Users/wenshao/pr13918-rig
bash it3.sh r4 r4 r4-guard "ManagedSessionGuardConvoyIT,WorkspaceLifecycleMySqlIT,ToolPublicationLockOrderMySqlIT,ManagedRuntimeRetentionGuardMySqlIT,WorkspaceSessionRetentionMySqlIT,ManagedAgentCsiMutationMySqlIT"
bash it3.sh r3w r3 r3w-csiwit "ManagedAgentCsiMutationMySqlIT"
echo IT4-BATCH-DONE
