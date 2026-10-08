cd /rig; M="mysql -h127.0.0.1 -P3306 -uroot -N -B $DB"
sq() { $M -e "$1"; }
W() { ps -eo args | grep -c "[m]anaged-runtime-worker"; }
newp() { node lclient.mjs $DB create "$1" | sed -n 's/^{"status":202,"json":{"id":"\([0-9a-f-]*\)".*/\1/p'; }
waitT() { node lclient.mjs $DB wait $1 $2 | grep -E "TERMINAL|TIMEOUT|saw=" | grep -o 'saw=[^"]*\|TERMINAL.*\|TIMEOUT' | cut -c1-260; }
kids() { sq "SELECT session_id, status FROM managed_agent_session WHERE parent_session_id='$1'"; }
st() { sq "SELECT status FROM managed_agent_session WHERE session_id='$1'"; }
ledger() { sq "SELECT r.domain, r.revision, IFNULL(r.task_state,'-'), IFNULL(r.delivery_state,'-'), IFNULL(l.state,'-'), IFNULL(l.attempts,'-'), IFNULL(LEFT(l.last_error,120),'-') FROM qwen_managed_session_extension_record r LEFT JOIN qwen_managed_child_result_relay l ON l.parent_session_id=r.session_id AND l.child_run_id=r.record_id WHERE r.session_id='$1' ORDER BY r.domain, r.record_id"; }
ops() { sq "SELECT IF(s.parent_session_id IS NULL,'parent','child '), o.operation_kind, o.state, IFNULL(o.error_code,'-'), o.lifecycle_protocol_version, o.attempt_count, FROM_UNIXTIME(o.created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(o.completed_at/1000,'%H:%i:%s'),'-') FROM managed_agent_operation o JOIN managed_agent_session s ON s.tenant_id=o.tenant_id AND s.session_id=o.session_id WHERE s.session_id='$1' OR s.parent_session_id='$1' ORDER BY o.created_at"; }
turns() { sq "SELECT IF(s.parent_session_id IS NULL,'parent','child '), t.status, IFNULL(t.error_code,'-'), FROM_UNIXTIME(t.created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(t.completed_at/1000,'%H:%i:%s'),'-') FROM managed_agent_turn t JOIN managed_agent_session s ON s.tenant_id=t.tenant_id AND s.session_id=t.session_id WHERE s.session_id='$1' OR s.parent_session_id='$1' ORDER BY t.created_at"; }
untilst() { for i in $(seq $3); do [ "$($2)" = "$4" ] && { echo "   $1 reached $4 after ${i}s"; return 0; }; sleep 1; done; echo "   $1 NOT $4 within $3s (now: $($2 | tr '\n' ' '))"; }
