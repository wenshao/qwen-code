#!/bin/bash
# V37 on a 1.74M-row managed_agent_event while an "old fleet" keeps inserting events:
# is ingestion blocked during the index build? Runs on r13217_mig (already at V39).
set -u
M=/Users/wenshao/pr13217-rig/my
DB=r13217_mig
OUT=/Users/wenshao/pr13217-rig/out/ddl-online.txt
$M $DB -e "DROP INDEX managed_agent_event_type_idx ON managed_agent_event" 2>&1
$M $DB -e "DROP TABLE IF EXISTS rig_ddl_probe; CREATE TABLE rig_ddl_probe (i INT PRIMARY KEY, started DATETIME(6), us BIGINT)"
$M $DB -e "DROP PROCEDURE IF EXISTS rig_ingest;
CREATE PROCEDURE rig_ingest(n INT)
BEGIN
  DECLARE i INT DEFAULT 0; DECLARE t0 DATETIME(6);
  WHILE i < n DO
    SET t0 = NOW(6);
    INSERT INTO managed_agent_event (tenant_id, session_id, sequence_id, event_id, turn_id, event_type, data_json, terminal, source_key, created_at)
      VALUES ('ddl-tenant', 'ddl-session', i + 1, CONCAT('ddl-', i), 'ddl-turn', 'item.output_text.delta', '{}', 0, NULL, 0);
    INSERT INTO rig_ddl_probe VALUES (i, t0, TIMESTAMPDIFF(MICROSECOND, t0, NOW(6)));
    DO SLEEP(0.005);
    SET i = i + 1;
  END WHILE;
END"
$M $DB -e "CALL rig_ingest(3000)" &
ING=$!
sleep 2
T0=$(node -e 'console.log(Date.now())')
$M $DB -e "SELECT NOW(6) INTO @s; CREATE INDEX managed_agent_event_type_idx ON managed_agent_event (tenant_id, session_id, event_type, sequence_id); SELECT 'ddl_start', @s, 'ddl_end', NOW(6);" > /Users/wenshao/pr13217-rig/out/ddl-raw.txt 2>&1
T1=$(node -e 'console.log(Date.now())')
wait $ING
{
echo "index build wall ms: $((T1 - T0))"
cat /Users/wenshao/pr13217-rig/out/ddl-raw.txt
$M $DB -N -e "SELECT CONCAT('inserts total ', COUNT(*), ', max us ', MAX(us), ', p99 us ', (SELECT us FROM rig_ddl_probe ORDER BY us DESC LIMIT 1 OFFSET 29)) FROM rig_ddl_probe"
} | tee $OUT
rm -f /Users/wenshao/pr13217-rig/out/ddl-raw.txt
