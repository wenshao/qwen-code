-- Rig only: give new parent Workspace Sessions the internal team-lead profile (child Agents attach).
-- On main, public Shell sessions set suppressChildAgents; only insertInternalTeamLeadSessionCommand
-- (used by HostedTeamLeadMySqlIT) creates this profile, and it has no public caller.
CREATE TABLE IF NOT EXISTS rig_profile (mode VARCHAR(16) NOT NULL);
DELETE FROM rig_profile; INSERT INTO rig_profile VALUES ('teamlead');
DROP TRIGGER IF EXISTS rig_shell_profile;
DELIMITER //
CREATE TRIGGER rig_shell_profile BEFORE INSERT ON managed_agent_session FOR EACH ROW
BEGIN
  IF NEW.parent_session_id IS NULL AND NEW.tool_profile = 'hosted-workspace-files/1' AND (SELECT mode FROM rig_profile LIMIT 1) = 'teamlead' THEN
    SET NEW.tool_profile = 'hosted-workspace-team-lead/1';
  END IF;
END//
DELIMITER ;
