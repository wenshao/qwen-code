#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
MY="/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -h127.0.0.1 -P23099 -uroot -prig13099 -N -B rig2"
SID=$($MY -e "SELECT session_id FROM managed_agent_session WHERE workspace_id='ws-r5'" 2>/dev/null)
echo "r5 session=$SID now=$(date -u +%T)"
$MY -e "SELECT status, retry_count, IFNULL(error_code,'-'), harness_last_event_id FROM managed_agent_turn WHERE session_id='$SID'" 2>/dev/null
$MY -e "SHOW TABLES LIKE 'qwen_managed_session%'" 2>/dev/null | tr '\n' ' '; echo
T=$($MY -e "SHOW TABLES LIKE 'qwen_managed_session_journal_e%'" 2>/dev/null | head -1)
echo "journal table: $T"
$MY -e "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='rig2' AND TABLE_NAME='$T'" 2>/dev/null | tr '\n' ' '; echo
$MY -e "SELECT event_kind, COUNT(*), MAX(event_sequence) FROM $T WHERE session_id='$SID' GROUP BY event_kind" 2>/dev/null
echo "--- harness log for the session (non-heartbeat, non-load)"
/usr/bin/grep "$SID" $S/logs/harness-rig2.log | /usr/bin/grep -v "heartbeat\|/load " | tail -5 | cut -c1-200
echo "--- load 409 count: $(/usr/bin/grep "$SID/load" $S/logs/harness-rig2.log | /usr/bin/grep -c 'status=409')  last: $(/usr/bin/grep "$SID/load" $S/logs/harness-rig2.log | tail -1 | cut -c1-24)"
echo "--- file written by the turn: $(cat $S/rig/roots/e/child/r5.txt 2>/dev/null)"
