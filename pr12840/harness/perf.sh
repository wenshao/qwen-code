#!/bin/bash
# V15 cost: one Session with N legacy events (60% text deltas), migrated by the
# PR jar under a given heap. usage: perf.sh <label> <jdbcBase> <dbPort> <events> <heap>
SP=/path/to/scratchpad
LABEL=$1; JB=$2; DBP=$3; N=$4; HEAP=$5
DB=p840_perf_$LABEL; PORT=33855; U=http://127.0.0.1:$PORT; T=rig-perf-$LABEL
M=$HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql
db() { $M --no-defaults -uroot -prig12840 -h127.0.0.1 -P$DBP -N -B "$@" 2>/dev/null; }
wait_up() { for i in $(seq 1 ${WAIT:-120}); do [ "$(curl -s -o /dev/null -w '%{http_code}' $U/actuator/health)" = 200 ] && return 0; kill -0 $PID 2>/dev/null || return 1; sleep 1; done; return 1; }
db -e "DROP DATABASE IF EXISTS $DB"
$SP/rig/spring.sh $SP/jars/base-server.jar $PORT 33854 $JB $DB > $SP/logs/perf-$LABEL-base.log 2>&1 & PID=$!
wait_up || { echo "base did not start"; exit 1; }
S=$(curl -s -X POST -H "X-Qwen-Tenant-Id: $T" -H 'content-type: application/json' -H "Idempotency-Key: perf-$LABEL" $U/v1/agents/sessions -d '{"agent_id":"qwen-code","input":[]}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
sleep 2; kill $PID; wait $PID 2>/dev/null
echo "session $S; inserting $N events"
t0=$(date +%s)
CHUNK=50000
for ((from=2; from<=N+1; from+=CHUNK)); do
  to=$(( from + CHUNK - 1 )); [ $to -gt $((N+1)) ] && to=$((N+1))
  db $DB -e "SET SESSION cte_max_recursion_depth = 1000000;
  INSERT INTO managed_agent_event (tenant_id, session_id, sequence_id, event_id, turn_id, event_type, data_json, terminal, source_key, created_at)
  WITH RECURSIVE n(i) AS (SELECT $from UNION ALL SELECT i + 1 FROM n WHERE i < $to)
  SELECT '$T', '$S', i, CONCAT('evt_perf_', i), CONCAT('turn_perf_', i DIV 100),
    CASE WHEN i MOD 100 = 2 THEN 'turn.accepted' WHEN i MOD 100 = 1 THEN 'turn.completed' WHEN i MOD 10 < 6 THEN 'item.output_text.delta' WHEN i MOD 10 < 8 THEN 'item.reasoning.delta' ELSE 'item.tool_call.updated' END,
    CASE WHEN i MOD 100 = 2 THEN '{\"input\":[{\"type\":\"text\",\"text\":\"perf\"}]}' WHEN i MOD 10 < 8 THEN CONCAT('{\"text\":\"', REPEAT('t', 80), '\"}') ELSE CONCAT('{\"toolCallId\":\"call_', i MOD 7, '\",\"status\":\"in_progress\"}') END,
    i MOD 100 = 1, NULL, 1790000000000 + i FROM n" || { echo "insert failed at $from"; exit 1; }
done
db $DB -e "UPDATE managed_agent_session SET last_sequence = $((N+1)) WHERE tenant_id = '$T'"
echo "inserted in $(( $(date +%s) - t0 ))s; table rows: $(db $DB -e "SELECT COUNT(*) FROM managed_agent_event")"
t1=$(date +%s)
JAVA_TOOL_OPTIONS="-Xmx$HEAP $JVMX" $SP/rig/spring.sh $SP/jars/${PRJAR:-pr-server.jar} $PORT 33854 $JB $DB --qwen.managed-agent.harness.enabled=false > $SP/logs/perf-$LABEL-pr.log 2>&1 & PID=$!
if wait_up; then
  echo "PR jar up after $(( $(date +%s) - t1 ))s (heap $HEAP)"
  db $DB -e "SELECT CONCAT(version, ' ', type, ' ', execution_time, 'ms success=', success) FROM flyway_schema_history WHERE version IN ('14','15')"
  db $DB -e "SELECT COUNT(*), SUM(item_id IS NOT NULL), SUM(content_part_id IS NOT NULL), COUNT(DISTINCT content_part_id) FROM managed_agent_event WHERE tenant_id = '$T'"
else
  echo "PR jar FAILED to start (heap $HEAP) after $(( $(date +%s) - t1 ))s"
  grep -m3 -E "OutOfMemory|Caused by|Migration .* failed|FAILED" $SP/logs/perf-$LABEL-pr.log | cut -c1-300
  db $DB -e "SELECT CONCAT(version, ' ', type, ' ', execution_time, 'ms success=', success) FROM flyway_schema_history WHERE version IN ('14','15')"
fi
if kill -0 $PID 2>/dev/null; then
  ~/Install/jdk21/bin/jcmd $PID Thread.print 2>/dev/null | awk '/^"main"/,/^$/' | grep -E "at (org.flywaydb|com.zaxxer|db.migration|com.mysql.cj.jdbc.ConnectionImpl)" | head -6 > $SP/logs/perf-$LABEL-main-stack.txt
  echo "JVM alive; main thread: $(head -3 $SP/logs/perf-$LABEL-main-stack.txt | sed 's/^[[:space:]]*//' | tr '\n' ' ')"
  ~/Install/jdk21/bin/jstat -gcutil $PID | tail -1 | awk '{print "old gen " $4 "%"}'
fi
kill $PID 2>/dev/null; for i in $(seq 1 20); do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
kill -0 $PID 2>/dev/null && { echo "ignored SIGTERM for 10 s; SIGKILL"; kill -9 $PID; }
wait $PID 2>/dev/null
echo done
