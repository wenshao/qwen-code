#!/bin/bash
# usage: lcollect8.sh <db> <name>...  — inside the container: status, Tool executions/publications, broker calls
cd /rig; DB=$1; shift; D=runs/$DB
./lst7.sh $DB "$@" > $D/status-final.txt 2>&1
mysql -h127.0.0.1 -uroot -B -e "SELECT substr(runtime_session_id,1,20) rs, substr(turn_id,1,30) turn, execution_state, IFNULL(execution_status,'-') status, IFNULL(REGEXP_SUBSTR(reference_json,'\"dispatchMode\":\"[a-z_0-9]+\"'),'-') mode, IFNULL(REGEXP_SUBSTR(reference_json,'\"promptId\":\"[^\"]{1,40}'),'-') prompt, IFNULL(settled_at,'-') settled_at FROM qwen_tool_execution ORDER BY settled_at" $DB > $D/executions.txt 2>&1
mysql -h127.0.0.1 -uroot -B -e "SELECT substr(session_id,1,8) s, state, producer_phase, capture_used_bytes, accepted_complete FROM qwen_tool_publication" $DB > $D/publications.txt 2>&1
./lev7.sh $DB 00:00:00 > $D/evidence.txt 2>&1
echo "collected $DB"
