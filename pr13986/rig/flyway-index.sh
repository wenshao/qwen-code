#!/bin/bash
# flyway-index.sh <engine: mysql84|mariadb> — V69 on a real engine:
#  1. base jar migrates a fresh DB (to V68), then stops;
#  2. N synthetic ledger rows are inserted (many harness Sessions);
#  3. pr jar boots on that DB: Flyway applies V69 (timed from its log);
#  4. SHOW INDEX + EXPLAIN of the exact repository query.
set -u
cd /root/pr13986-rig
ENGINE=$1; N=${N:-200000}
O=out/flyway-$ENGINE; mkdir -p $O; : > $O/steps.log
log() { echo "$(date +%T) $*" | tee -a $O/steps.log; }
if [ $ENGINE = mysql84 ]; then
  PORT=13987; DB=q84
  docker rm -f pr13986-my84 >/dev/null 2>&1
  docker run -d --name pr13986-my84 -p 127.0.0.1:$PORT:3306 -e MYSQL_ROOT_PASSWORD=r13986 \
    --memory 2g docker.m.daocloud.io/library/mysql:8.4 >/dev/null
  M() { docker exec -i pr13986-my84 mysql -uroot -pr13986 -N -B "$@" 2>/dev/null; }
  for i in $(seq 1 90); do M -e 'SELECT 1' >/dev/null && break; sleep 2; done
else
  PORT=13986; DB=q_flyway_maria
  M() { mysql --socket=db/s.sock -uroot -pr13986 -N -B "$@"; }
fi
log "engine: $(M -e 'SELECT VERSION()')"
M -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;"
URL="jdbc:mysql://127.0.0.1:$PORT/$DB?useSSL=false&allowPublicKeyRetrieval=true"
boot() { # boot <jar> <log>
  env -i HOME=/tmp PATH=/usr/bin:/bin ./jdk21/bin/java -jar server/$1.jar --server.address=127.0.0.1 --server.port=18996 \
    --spring.datasource.url="$URL" --spring.datasource.username=root --spring.datasource.password=r13986 \
    > $O/$2 2>&1 &
  local pid=$!
  for i in $(seq 1 120); do
    grep -q -E "Started ManagedAgentServerApplication|APPLICATION FAILED|Exception in thread" $O/$2 && break; sleep 1
  done
  log "$1: $(grep -h -o -E 'Successfully applied [0-9]+ migrations?[^,]*, now at version v[0-9]+|Schema `[a-z0-9_]+` is up to date|Migrating schema `[a-z0-9_]+` to version "69[^"]*"|Started ManagedAgentServerApplication in [0-9.]+ seconds|APPLICATION FAILED TO START' $O/$2 | tr '\n' ';')"
  kill $pid; wait $pid 2>/dev/null
}
boot base base-boot.log
log "history tail: $(M $DB -e 'SELECT version FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1')"
# Synthetic ledger: N rows over N/50 harness Sessions; every 10th row a hold row.
SEQ="WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < $N) SELECT n FROM s"
T0=$(date +%s)
if [ $ENGINE = mysql84 ]; then RV="SET SESSION cte_max_recursion_depth = 10000000;"; else RV="SET SESSION max_recursive_iterations = 10000000;"; fi
M $DB -e "$RV INSERT INTO qwen_tool_execution (execution_call_id_hash, execution_call_id, idempotency_key_hash, idempotency_key, binding_id, runtime_generation, harness_session_id, runtime_session_id, runtime_session_key, turn_id, tool_call_id, request_digest, reference_json, execution_state, execution_status, last_sequence, cancel_requested, dispatch_generation, record_version) SELECT SHA2(CONCAT('e', n), 256), CONCAT('exec-', n), SHA2(CONCAT('i', n), 256), CONCAT('idem-', n), 'binding-1', 1, CONCAT('hs-', LPAD(FLOOR(n / 50), 8, '0')), CONCAT('rs-', FLOOR(n / 10)), SHA2(CONCAT('rk', FLOOR(n / 10)), 256), CONCAT('turn-', n), CONCAT('call-', n), 'sha256:0', IF(MOD(n, 10) = 0, '{\"dispatchMode\":\"background_v3_process\"}', '{\"dispatchMode\":\"deferred_v3\"}'), 'SETTLED', 'success', 0, FALSE, 0, 1 FROM ($SEQ) t"
log "inserted $(M $DB -e 'SELECT COUNT(*) FROM qwen_tool_execution') ledger rows in $(( $(date +%s) - T0 ))s"
QRY="SELECT execution_call_id FROM qwen_tool_execution WHERE harness_session_id = 'hs-00001234' AND execution_call_id_hash > '' ORDER BY execution_call_id_hash LIMIT 100"
M $DB -e "ANALYZE TABLE qwen_tool_execution" >/dev/null
log "EXPLAIN before V69: $(M $DB -e "EXPLAIN $QRY" | tr '\t' ' ')"
boot pr pr-boot.log
log "V69 history: $(M $DB -e "SELECT version, description, execution_time, success FROM flyway_schema_history WHERE version='69'" | tr '\t' ' ')"
log "SHOW INDEX: $(M $DB -e "SHOW INDEX FROM qwen_tool_execution WHERE Key_name='idx_tool_execution_harness'" | awk '{print $3, $4, $5}' | tr '\n' ';')"
M $DB -e "ANALYZE TABLE qwen_tool_execution" >/dev/null
log "EXPLAIN after V69: $(M $DB -e "EXPLAIN $QRY" | tr '\t' ' ')"
log "rows matched: $(M $DB -e "SELECT COUNT(*) FROM ($QRY) x")"
log "query ms (x200): $(M $DB -e "SELECT 1" >/dev/null; s=$(date +%s%N); for i in $(seq 1 200); do M $DB -e "$QRY" >/dev/null; done; echo $(( ($(date +%s%N) - s) / 200000000 ))ms/query incl. client spawn)"
[ $ENGINE = mysql84 ] && docker rm -f pr13986-my84 >/dev/null
log "DONE"
