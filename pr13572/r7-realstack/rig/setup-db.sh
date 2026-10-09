#!/bin/bash
# usage: setup-db.sh <db>  — workspace registration + rig profile switch (after Flyway ran)
DB=$1; S=/Users/wenshao/git/pr13572-rig/mysql.sh
# main's V53 (workspace roles) replaced can_read/can_create with a role column.
if [ "$($S sql -N -e "select count(*) from information_schema.columns where table_schema='$DB' and table_name='managed_workspace_access' and column_name='role'")" = 1 ]; then
  ACCESS="INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-actor','OPERATOR');"
else
  ACCESS="INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('rig','rig-ws','rig-actor',TRUE,TRUE);"
fi
$S sql $DB <<SQL
INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state)
  VALUES ('rig','rig-ws',1,'rig-storage','Rig','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE');
$ACCESS
CREATE TABLE IF NOT EXISTS rig_profile (mode VARCHAR(16) NOT NULL);
INSERT INTO rig_profile SELECT 'files' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rig_profile);
DROP TRIGGER IF EXISTS rig_shell_profile;
CREATE TRIGGER rig_shell_profile BEFORE INSERT ON managed_agent_session FOR EACH ROW
  SET NEW.tool_profile = IF(NEW.tool_profile = 'hosted-workspace-files/1' AND (SELECT mode FROM rig_profile LIMIT 1) = 'shell', 'hosted-workspace-shell/1', NEW.tool_profile);
SELECT 'ok', (SELECT mode FROM rig_profile LIMIT 1);
SQL
