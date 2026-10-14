#!/bin/bash
# Round-3 MySQL 8.4.7 IT runs on the dedicated IT server (23921), sequential.
cd /Users/wenshao/pr13918-rig
bash it3.sh r3 r3 r3-guard "ManagedSessionGuardConvoyIT,WorkspaceLifecycleMySqlIT,ToolPublicationLockOrderMySqlIT,ManagedRuntimeRetentionGuardMySqlIT,WorkspaceSessionRetentionMySqlIT"
bash it3.sh c7 c7 c7-convoy "ManagedSessionGuardConvoyIT"
bash it3.sh r3mut r3 r3mut-m1 "ManagedSessionGuardConvoyIT,WorkspaceLifecycleMySqlIT"
echo IT3-BATCH-DONE
