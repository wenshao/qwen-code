#!/bin/bash
# usage: setup-db.sh <db>  — workspace registration + rig profile switch + child-creation delay knob (after Flyway ran)
DB=$1; S=/Users/wenshao/git/pr13769-rig/mysql.sh
$S sql $DB <<'SQL'
INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state)
  VALUES ('rig','rig-ws',1,'rig-storage','Rig','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE');
INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-actor','OPERATOR');
CREATE TABLE IF NOT EXISTS rig_profile (mode VARCHAR(16) NOT NULL);
INSERT INTO rig_profile SELECT 'shell' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rig_profile);
CREATE TABLE IF NOT EXISTS rig_child_delay (secs INT NOT NULL);
INSERT INTO rig_child_delay SELECT 0 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rig_child_delay);
DROP TRIGGER IF EXISTS rig_shell_profile;
DELIMITER //
CREATE TRIGGER rig_shell_profile BEFORE INSERT ON managed_agent_session FOR EACH ROW
BEGIN
  SET NEW.tool_profile = IF(NEW.tool_profile = 'hosted-workspace-files/1' AND (SELECT mode FROM rig_profile LIMIT 1) = 'shell', 'hosted-workspace-shell/1', NEW.tool_profile);
  -- Fault knob: hold a child Session's creation so a Harness restart lands
  -- after the parent's admission but before the child exists.
  IF NEW.parent_session_id IS NOT NULL AND (SELECT secs FROM rig_child_delay LIMIT 1) > 0 THEN
    DO SLEEP((SELECT secs FROM rig_child_delay LIMIT 1));
  END IF;
END//
DELIMITER ;
SELECT 'ok', (SELECT mode FROM rig_profile LIMIT 1), (SELECT secs FROM rig_child_delay LIMIT 1);
SQL
