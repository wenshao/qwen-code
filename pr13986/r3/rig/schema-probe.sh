#!/bin/bash
# schema-probe.sh <mariadb|mysql84> — the PR's index in the canonical V1 on a
# real engine (Spring/Flyway path + standalone Broker path), 200k-row EXPLAIN,
# upgrade/rollback against a DB created by main, and the exact-identity read.
set -u
cd /root/pr13986-rig
ENGINE=$1; N=${N:-200000}
O=out/schema-$ENGINE; mkdir -p $O; : > $O/steps.log
log() { echo "$(date +%T) $*" | tee -a $O/steps.log; }
if [ $ENGINE = mysql84 ]; then
  PORT=13987
  docker rm -f pr13986-my84 >/dev/null 2>&1
  docker run -d --name pr13986-my84 -p 127.0.0.1:$PORT:3306 -e MYSQL_ROOT_PASSWORD=r13986 \
    --memory 2g docker.m.daocloud.io/library/mysql:8.4 >/dev/null
  M() { docker exec -i pr13986-my84 mysql -uroot -pr13986 -N -B "$@" 2>/dev/null; }
  for i in $(seq 1 90); do M -e 'SELECT 1' >/dev/null && break; sleep 2; done
  RV="SET SESSION cte_max_recursion_depth = 10000000;"
  ANALYZE_Q() { M "$1" -e "EXPLAIN ANALYZE $2" | tr '\n' ' ' | cut -c1-400; }
else
  PORT=13986
  M() { mysql --socket=db/s.sock -uroot -pr13986 -N -B "$@"; }
  RV="SET SESSION max_recursive_iterations = 10000000;"
  ANALYZE_Q() { M "$1" -e "ANALYZE $2" | tr '\t' ' ' | tr '\n' ' '; }
fi
log "engine: $(M -e 'SELECT VERSION(), @@collation_server' | tr '\t' ' ')"
URL() { echo "jdbc:mysql://127.0.0.1:$PORT/$1?useSSL=false&allowPublicKeyRetrieval=true"; }
fresh() { M -e "DROP DATABASE IF EXISTS $1; CREATE DATABASE $1;"; }
boot() { # boot <jar> <db> <log>
  env -i HOME=/tmp PATH=/usr/bin:/bin ./jdk21/bin/java -jar server/$1.jar --server.address=127.0.0.1 --server.port=18996 \
    --spring.datasource.url="$(URL $2)" --spring.datasource.username=root --spring.datasource.password=r13986 \
    > $O/$3 2>&1 &
  local pid=$!
  for i in $(seq 1 150); do
    grep -q -E "Started ManagedAgentServerApplication|APPLICATION FAILED|Application run failed|Exception in thread" $O/$3 && break
    kill -0 $pid 2>/dev/null || break; sleep 1
  done
  sleep 1
  local ok=$(grep -h -o -E 'Started ManagedAgentServerApplication in [0-9.]+ seconds' $O/$3)
  local why=$(grep -h -o -E '(Managed schema[^:]*: [^"]{0,140}|Migration checksum mismatch for migration version [0-9]+|-> Applied to database : -?[0-9]+|-> Resolved locally    : -?[0-9]+|Successfully applied [0-9]+ migration[^,]*, now at version v[0-9]+|Successfully baselined[^.]*|Schema `[a-z0-9_]+` is up to date)' $O/$3 | sort -u | tr '\n' ';')
  log "boot $1 on $2: ${ok:-NOT STARTED} | $why"
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
}
IDX() { M $1 -e "SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema='$1' AND table_name='ma_tool_execution' GROUP BY index_name ORDER BY index_name" | tr '\t' '(' | sed 's/$/)/' | tr '\n' ' '; }
CHK() { M $1 -e "SELECT version, checksum FROM flyway_schema_history WHERE version IS NOT NULL" | tr '\t' ' ' | tr '\n' ';'; }

# 1. fresh DBs through the Spring/Flyway path
fresh sp_pr; boot pr3 sp_pr pr-fresh.log
log "sp_pr indexes: $(IDX sp_pr)"; log "sp_pr V1 checksum: $(CHK sp_pr)"
fresh sp_main; boot base3 sp_main main-fresh.log
log "sp_main indexes: $(IDX sp_main)"; log "sp_main V1 checksum: $(CHK sp_main)"

# 2. 200k synthetic ledger rows over N/50 Harness Sessions (every 10th a hold row) in both
SEQ="WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < $N) SELECT n FROM s"
for db in sp_pr sp_main; do
  T0=$(date +%s)
  M $db -e "$RV INSERT INTO ma_tool_execution (execution_call_id_hash, execution_call_id, idempotency_key_hash, idempotency_key, binding_id, runtime_generation, harness_session_id, runtime_session_id, runtime_session_key, turn_id, tool_call_id, request_digest, reference_json, execution_state, execution_status, last_sequence, cancel_requested, dispatch_generation, record_version) SELECT SHA2(CONCAT('e', n), 256), CONCAT('exec-', n), SHA2(CONCAT('i', n), 256), CONCAT('idem-', n), 'binding-1', 1, CONCAT('hs-', LPAD(FLOOR(n / 50), 8, '0')), CONCAT('rs-', FLOOR(n / 10)), SHA2(CONCAT('rk', FLOOR(n / 10)), 256), CONCAT('turn-', n), CONCAT('call-', n), 'sha256:0', IF(MOD(n, 10) = 0, '{\"dispatchMode\":\"background_v3_process\"}', '{\"dispatchMode\":\"deferred_v3\"}'), 'SETTLED', 'success', 0, FALSE, 0, 1 FROM ($SEQ) t"
  M $db -e "ANALYZE TABLE ma_tool_execution" >/dev/null
  log "$db: $(M $db -e 'SELECT COUNT(*) FROM ma_tool_execution') rows in $(( $(date +%s) - T0 ))s"
done
QRY="SELECT execution_call_id FROM ma_tool_execution WHERE harness_session_id = _binary'hs-00001234' AND execution_call_id_hash > '' ORDER BY execution_call_id_hash LIMIT 100"
for db in sp_main sp_pr; do
  log "EXPLAIN $db: $(M $db -e "EXPLAIN $QRY" | tr '\t' ' ')"
  log "ANALYZE $db: $(ANALYZE_Q $db "$QRY")"
  log "matched $db: $(M $db -e "SELECT COUNT(*) FROM ($QRY) x")"
done

# 3. upgrade / rollback across main's V1 and the PR's V1
boot pr3 sp_main upgrade-main-db-with-pr.log
M sp_main -e "CREATE INDEX idx_tool_execution_harness ON ma_tool_execution (harness_session_id, execution_call_id_hash)"
log "sp_main + manual index: $(IDX sp_main)"
boot pr3 sp_main upgrade-main-db-plus-index-with-pr.log
boot base3 sp_pr rollback-pr-db-with-main.log

# 4. standalone Broker initializer (JdbcRuntimeBrokerSchema.initialize -> ManagedSchema.initialize)
for arm in base3 pr3; do
  [ -d lib-$arm ] || { mkdir -p lib-$arm.x && (cd lib-$arm.x && ../jdk21/bin/jar xf ../server/$arm.jar BOOT-INF/lib) && mv lib-$arm.x/BOOT-INF/lib lib-$arm && rm -rf lib-$arm.x; }
done
J=./jdk21/bin/java
runi() { local arm=$1; shift; $J -cp "lib-$arm/*" ProbeInit3.java "$@" 2>&1 | grep -v -E "^WARNING|SLF4J" | tr '\n' ' ' | cut -c1-600; }
run() { local arm=$1; shift; $J -cp "lib-$arm/*" Probe3.java "$@" 2>&1 | grep -v -E "^WARNING|SLF4J" | tr '\n' ' ' | cut -c1-800; }
fresh jp_pr; fresh jp_main
log "standalone pr3 init fresh:       $(runi pr3 init "$(URL jp_pr)")"
log "standalone pr3 init again:       $(runi pr3 init "$(URL jp_pr)")"
log "standalone base3 init fresh:     $(runi base3 init "$(URL jp_main)")"
log "standalone pr3 init on main DB:  $(runi pr3 init "$(URL jp_main)")"

# 5. exact Harness identity through the PR's JDBC read
log "alias: $(run pr3 alias "$(URL jp_pr)")"
[ $ENGINE = mysql84 ] && docker rm -f pr13986-my84 >/dev/null
for db in sp_pr sp_main jp_pr jp_main; do M -e "DROP DATABASE IF EXISTS $db"; done
log "DONE"
