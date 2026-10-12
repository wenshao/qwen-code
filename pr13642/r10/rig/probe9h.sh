#!/bin/bash
# Round 9: one released binding whose Session ran N background Shells (all settled, so nothing needs protection)
# versus the retention sweep on the real jar. A control family sorts after it in keyset order.
# usage: probe9h.sh <mysql|maria> <jar> <tag> <N> [watch_seconds] [noise_sessions]
# Noise: other Sessions' child_run records in the same tenant (20 each, a quarter unsettled), as any shared table holds.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; JAR=$2; T=$3; N=$4; WATCH=${5:-75}; NOISE=${6:-1000}; P=QWEN_MANAGED_AGENT_RUNTIME; D=p9h_${T//-/_}
export SERVER_PORT=18732 BROKER_PORT=18733 CPDIR=cp-r9 SEEDOUT=out-r9
[ "$DB" = mysql ] && PORT=33642 || PORT=43642
Q() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N $D -e "$1" 2>&1 | grep -v 'Using a password'; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid 2>/dev/null; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
fam() { Q "SELECT b.binding_id, b.binding_state, (SELECT COUNT(*) FROM qwen_runtime_session s WHERE s.binding_id=b.binding_id), (SELECT COUNT(*) FROM qwen_tool_execution x WHERE x.binding_id=b.binding_id) FROM qwen_runtime_binding b WHERE b.binding_id IN ('hv-done','ctl-done') ORDER BY b.last_active_at" | awk -F'\t' '{printf "    %-9s %s sessions=%s executions=%s\n", $1, $2, $3, $4}'; n=$(Q "SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id IN ('hv-done','ctl-done')"); [ "$n" = 0 ] && echo "    (both families collected)"; }
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -e "DROP DATABASE IF EXISTS $D" 2>/dev/null
echo "## [$T] jar=$(basename $JAR) db=$D N=$N"
R=$($S/rig/boot.sh $JAR $DB $D $T-schema ${P}_BROKER_ENABLED=true); [ "${R%% *}" = STARTED ] || { echo "schema boot: $R"; exit 1; }; stop $T-schema
for f in hv-done ctl-done; do out=$($S/rig/seed.sh $DB $D stranded $f 2>&1); m=$(echo "$out" | grep -E "^STRANDED $f "); [ -n "$m" ] || { echo "$out" | head -3; echo "seed $f failed (no STRANDED marker)"; exit 1; }; echo "$m"; done
# Execution keys use JdbcRepositorySupport.digest: SHA-256 over a 4-byte big-endian length then the UTF-8 bytes.
# N more background Shells on hv-done's binding: <id>-x<i> plus its <id>-x<i>:process row, all SETTLED 40 days ago;
# and N matching background_shell records (record_id = executionCallId), all settled.
Q "CREATE TABLE seq (i INT PRIMARY KEY)"
Q "SET SESSION cte_max_recursion_depth = 1000000" >/dev/null 2>&1
Q "SET SESSION cte_max_recursion_depth = 1000000; INSERT INTO seq WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < GREATEST($N, $NOISE * 20)) SELECT i FROM n" 2>/dev/null | grep -v '^$'
SEQ=$(( N > NOISE * 20 ? N : NOISE * 20 ))
[ "$(Q 'SELECT COUNT(*) FROM seq')" = "$SEQ" ] || Q "SET SESSION max_recursive_iterations = 10000000; INSERT INTO seq WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $SEQ) SELECT i FROM n"
[ "$(Q 'SELECT COUNT(*) FROM seq')" = "$SEQ" ] || { echo "seq fill failed"; exit 1; }
Q "INSERT INTO qwen_tool_execution (execution_call_id_hash, execution_call_id, idempotency_key_hash, idempotency_key, binding_id,
  runtime_generation, harness_session_id, runtime_session_id, runtime_session_key, turn_id, tool_call_id, request_digest, reference_json,
  execution_state, execution_status, result_json, last_sequence, cancel_requested, dispatch_generation, record_version, settled_at)
  SELECT SHA2(CONCAT(UNHEX(LPAD(HEX(LENGTH(CONCAT('hv-done-x', i, s.sfx))), 8, '0')), CONCAT('hv-done-x', i, s.sfx)), 256), CONCAT('hv-done-x', i, s.sfx),
  SHA2(CONCAT(UNHEX(LPAD(HEX(LENGTH(CONCAT('hv-key-', i, s.sfx))), 8, '0')), CONCAT('hv-key-', i, s.sfx)), 256), CONCAT('hv-key-', i, s.sfx),
  t.binding_id, t.runtime_generation, t.harness_session_id, t.runtime_session_id, t.runtime_session_key, t.turn_id, CONCAT('tc-', i, s.sfx),
  t.request_digest, t.reference_json, t.execution_state, t.execution_status, t.result_json, t.last_sequence, t.cancel_requested,
  t.dispatch_generation, t.record_version, t.settled_at
  FROM seq JOIN (SELECT '' sfx UNION ALL SELECT ':process') s JOIN qwen_tool_execution t ON t.execution_call_id = 'hv-done-call:process' WHERE i <= $N"
Q "INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain,
  record_id, operation_hash, revision, record_resource_id, task_kind, task_state, runtime_state, delivery_target, delivery_state, created_at, settled_at)
  SELECT t.session_scope_key, SHA2(CONCAT(t.session_id, CHAR(0), 'child_run', CHAR(0), 'hv-done-x', i), 256), t.tenant_id, t.workspace_id,
  t.session_id, 'child_run', CONCAT('hv-done-x', i), t.operation_hash, 2, 'resource', 'background_shell', 'settled', NULL, NULL, NULL, 1, 2
  FROM seq JOIN qwen_managed_session_extension_record t ON t.record_id = 'shell-hv-done' WHERE i <= $N"
Q "INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain,
  record_id, operation_hash, revision, record_resource_id, task_kind, task_state, runtime_state, delivery_target, delivery_state, created_at, settled_at)
  SELECT SHA2(CONCAT(t.tenant_id, CHAR(0), 'noise-', i DIV 20), 256), SHA2(CONCAT('noise-', i DIV 20, CHAR(0), 'child_run', CHAR(0), 'r', i), 256),
  t.tenant_id, t.workspace_id, CONCAT('noise-', i DIV 20), 'child_run', CONCAT('r', i), t.operation_hash, 2, 'resource', 'background_shell',
  'running', NULL, NULL, NULL, 1, IF(i MOD 4 = 0, NULL, 2)
  FROM seq JOIN qwen_managed_session_extension_record t ON t.record_id = 'shell-hv-done' WHERE i <= $NOISE * 20"
Q "ANALYZE TABLE qwen_tool_execution, qwen_managed_session_extension_record" >/dev/null
# the control family sorts strictly after the heavy one
Q "UPDATE qwen_runtime_binding SET last_active_at = (SELECT x.a FROM (SELECT last_active_at + INTERVAL 1 HOUR a FROM qwen_runtime_binding WHERE binding_id='hv-done') x) WHERE binding_id='ctl-done'"
echo "1. seeded: hv-done = 1 + $N background Shells in one top-level Session, every record settled (nothing to protect); ctl-done = an ordinary settled family sorting after it; plus $((NOISE*20)) child_run records of $NOISE other Sessions in the same tenant"
fam; echo "    hv-done unsettled background_shell records: $(Q "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='harness-hv-done' AND settled_at IS NULL")"
R=$($S/rig/boot.sh $JAR $DB $D $T-on ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_SCAN_DELAY=2s)
[ "${R%% *}" = STARTED ] || { echo "boot: $R"; exit 1; }
sleep $WATCH
L=$S/rig/logs/$T-on.log
ok=$(grep -c 'runtime_retention bindings_scanned' $L); bad=$(grep -c 'Runtime retention failed' $L)
echo "2. retention on (30d, scan 2s, batch 100) for ${WATCH} s: successful ticks=$ok failed ticks=$bad"
grep -E 'runtime_retention bindings_scanned' $L | sed -E 's/.*runtime_retention //' | awk '{print}' | head -3 | sed 's/^/    first ok: /'
grep -E 'runtime_retention bindings_scanned' $L | sed -E 's/.*runtime_retention //' | tail -2 | sed 's/^/    last ok:  /'
grep -A40 'Runtime retention failed' $L | grep -E '^(Caused by|[a-zA-Z.]+Exception)|^\s+at com\.alibaba\.qwen\.code\.managedagent\.store\.ManagedRuntimeRetentionGuard' | sed -E 's/^\s+//' | sort | uniq -c | sort -rn | head -6 | sed 's/^/    /'
grep -E 'Runtime retention failed' $L | head -1 | sed -E 's/^([0-9T:.-]+).*/    first failure at \1/'
grep -E 'Runtime retention failed' $L | tail -1 | sed -E 's/^([0-9T:.-]+).*/    last failure at  \1/'
fam
stop $T-on
echo "## [$T] done"
