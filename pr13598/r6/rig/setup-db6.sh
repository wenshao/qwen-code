#!/bin/bash
# usage: setup-db6.sh <db>  — workspace registration after Flyway ran (role column since the #13544 merge)
DB=$1; S=/Users/wenshao/git/pr13598-rig/mysql.sh
$S sql $DB <<SQL
INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state)
  VALUES ('rig','rig-ws',1,'rig-storage','Rig','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE');
INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-actor','OPERATOR');
INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-reader','READER');
SELECT 'ok';
SQL
