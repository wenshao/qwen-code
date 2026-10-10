#!/bin/bash
# usage: lsetup-db7.sh <db> [shell]  — workspace registration with the role column (after Flyway ran);
# "shell" makes every new files/1 Session a hosted-workspace-shell/1 Session (rig trigger).
DB=$1; MODE=${2:-files}
HASROLE=$(mysql -h127.0.0.1 -P3306 -uroot -N -B -e "select count(*) from information_schema.columns where table_schema='$DB' and table_name='managed_workspace_access' and column_name='role'")
if [ "$HASROLE" = 1 ]; then
  A1="INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-actor','OPERATOR');"
  A2="INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-reader','READER');"
else
  A1="INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('rig','rig-ws','rig-actor',TRUE,TRUE);"
  A2="INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('rig','rig-ws','rig-reader',TRUE,FALSE);"
fi
mysql -h127.0.0.1 -P3306 -uroot $DB <<SQL
INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state)
  VALUES ('rig','rig-ws',1,'rig-storage','Rig','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE');
$A1
$A2
CREATE TABLE IF NOT EXISTS rig_profile (mode VARCHAR(16) NOT NULL);
DELETE FROM rig_profile; INSERT INTO rig_profile VALUES ('$MODE');
DROP TRIGGER IF EXISTS rig_shell_profile;
CREATE TRIGGER rig_shell_profile BEFORE INSERT ON managed_agent_session FOR EACH ROW
  SET NEW.tool_profile = IF(NEW.tool_profile = 'hosted-workspace-files/1' AND (SELECT mode FROM rig_profile LIMIT 1) = 'shell', 'hosted-workspace-shell/1', NEW.tool_profile);
SELECT 'ok', (SELECT mode FROM rig_profile LIMIT 1);
SQL
