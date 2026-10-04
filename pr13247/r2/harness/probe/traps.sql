-- VERIFICATION RIG ONLY (PR #13247): fault/hold injection for cwd settlement, keyed by target-directory prefix.
CREATE TABLE IF NOT EXISTS rig_trap (name VARCHAR(32) PRIMARY KEY, secs DOUBLE NOT NULL);
INSERT IGNORE INTO rig_trap VALUES ('claim', 4), ('commit', 15);
DROP TRIGGER IF EXISTS rig_trap_session;
DROP TRIGGER IF EXISTS rig_trap_operation;
DELIMITER //
-- Commit window (after the probe passed, Session row locked): trap-fail* fails the first two attempts,
-- trap-slow* sleeps on claim generation 1 only.
CREATE TRIGGER rig_trap_session BEFORE UPDATE ON managed_agent_session FOR EACH ROW
BEGIN
  DECLARE attempts INT DEFAULT NULL;
  DECLARE gen BIGINT DEFAULT NULL;
  IF NEW.cwd_relative <> OLD.cwd_relative OR NEW.context_revision <> OLD.context_revision THEN
    SELECT attempt_count, claim_generation INTO attempts, gen FROM managed_agent_operation
      WHERE session_id = NEW.session_id AND operation_kind = 'CWD_CHANGE' AND state = 'RUNNING' LIMIT 1;
    IF NEW.cwd_relative LIKE 'trap-fail%' AND attempts < 2 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rig: injected commit failure';
    END IF;
    IF NEW.cwd_relative LIKE 'trap-slow%' AND gen = 1 THEN
      DO SLEEP((SELECT secs FROM rig_trap WHERE name = 'commit'));
    END IF;
  END IF;
END//
-- Claim window (before the probe): trap-claim* sleeps on the first claim only.
CREATE TRIGGER rig_trap_operation BEFORE UPDATE ON managed_agent_operation FOR EACH ROW
BEGIN
  IF NEW.operation_kind = 'CWD_CHANGE' AND OLD.state = 'PENDING' AND NEW.state = 'RUNNING'
     AND NEW.target_cwd_relative LIKE 'trap-claim%' AND OLD.claim_generation = 0 THEN
    DO SLEEP((SELECT secs FROM rig_trap WHERE name = 'claim'));
  END IF;
END//
DELIMITER ;
