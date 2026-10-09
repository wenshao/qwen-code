#!/bin/bash
# usage: st4.sh <db> <name>...  — compact state: turns, automation runs, occurrences per Session; Broker sessions, lease, Harness lines
cd /rig; db=$1; shift
S(){ mysql -h127.0.0.1 -P3306 -uroot -N -B -e "$1" $db; }
for n in "$@"; do sid=$(cat runs/$db/$n); echo "=== $n $sid"
  echo "-- turns"; S "SELECT turn_id, status, IFNULL(error_code,'-'), FROM_UNIXTIME(created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(completed_at/1000,'%H:%i:%s'),'-') FROM managed_agent_turn WHERE session_id='$sid' ORDER BY created_at"
  echo "-- runs"; S "SELECT substr(record_id,1,14), revision, IFNULL(task_state,'-'), IFNULL(runtime_state,'-'), FROM_UNIXTIME(created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(settled_at/1000,'%H:%i:%s'),'-') FROM qwen_managed_session_extension_record WHERE session_id='$sid' AND domain LIKE '%automation%' ORDER BY created_at"
  echo "-- occurrences"; S "SELECT substr(occurrence_key,1,40), substr(IFNULL(run_id,'-'),1,14), outcome, IFNULL(reason,'-'), FROM_UNIXTIME(updated_at/1000,'%H:%i:%s') FROM qwen_managed_automation_occurrence WHERE session_id='$sid' ORDER BY created_at"
done
echo "=== broker sessions (newest 8)"; S "SELECT substr(runtime_session_id,1,16), session_state, FROM_UNIXTIME(last_active_at/1000,'%H:%i:%s') FROM qwen_runtime_session ORDER BY last_active_at DESC LIMIT 8"
echo "=== execution lease"; S "SELECT substr(IFNULL(runtime_session_id,'-'),1,16), substr(holder_key,1,40) FROM managed_workspace_execution_lease"
echo "=== harness"; grep -E "recover|blocked|needs recovery|failed|could not|Monitor wake" runs/$db/harness.log | tail -10 | cut -c1-260
