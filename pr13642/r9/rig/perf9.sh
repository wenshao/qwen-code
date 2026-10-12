#!/bin/bash
# Round 9: cost of the PR's backgroundRunUnsettled query for one binding whose Session ran N background Shells,
# all settled (the steady state, where EXISTS finds nothing and must examine every candidate pair).
# usage: perf9.sh <mysql|maria> <N> [noise_sessions]
DB=$1; N=$2; NOISE=${3:-1000}
[ "$DB" = mysql ] && PORT=33642 || PORT=43642
SRC=p9a_r9_$DB; D=p9p_${DB}_$N
Q() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N "$@" 2>&1 | grep -v 'Using a password'; }
Q -e "DROP DATABASE IF EXISTS $D; CREATE DATABASE $D CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE $D.qwen_tool_execution LIKE $SRC.qwen_tool_execution;
CREATE TABLE $D.qwen_managed_session_extension_record LIKE $SRC.qwen_managed_session_extension_record;
CREATE TABLE $D.seq (i INT PRIMARY KEY);"
SEQ=$(( N > NOISE * 20 ? N : NOISE * 20 ))
if [ "$DB" = mysql ]; then SETV="SET SESSION cte_max_recursion_depth = 10000000"; else SETV="SET SESSION max_recursive_iterations = 10000000"; fi
Q $D -e "$SETV; INSERT INTO seq WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $SEQ) SELECT i FROM n"
[ "$(Q $D -e 'SELECT COUNT(*) FROM seq')" = "$SEQ" ] || { echo "FAILED: seq has $(Q $D -e 'SELECT COUNT(*) FROM seq') rows, want $SEQ"; exit 1; }
# the big Session: N invocation rows + N <call>:process rows on binding b1/gen 1, all SETTLED
Q $D -e "INSERT INTO qwen_tool_execution (execution_call_id_hash, execution_call_id, idempotency_key_hash, idempotency_key, binding_id,
  runtime_generation, harness_session_id, runtime_session_id, runtime_session_key, turn_id, tool_call_id, request_digest, reference_json,
  execution_state, last_sequence, cancel_requested, dispatch_generation, record_version)
  SELECT SHA2(CONCAT('call-', i, s.sfx), 256), CONCAT('call-', i, s.sfx), SHA2(CONCAT('key-', i, s.sfx), 256), CONCAT('key-', i, s.sfx), 'b1',
  1, 'big-session', 'rs', SHA2('rs', 256), 'turn', CONCAT('tc-', i), 'digest', '{}', 'SETTLED', 0, 0, 1, 1
  FROM seq JOIN (SELECT '' sfx UNION ALL SELECT ':process') s WHERE i <= $N"
# its N background_shell records (record_id = executionCallId, as production writes them), all settled
Q $D -e "INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain,
  record_id, operation_hash, revision, record_resource_id, task_kind, task_state, created_at, settled_at)
  SELECT SHA2(CONCAT('t', CHAR(0), 'big-session'), 256), SHA2(CONCAT('big-session', CHAR(0), 'child_run', CHAR(0), 'call-', i), 256),
  't', 'w', 'big-session', 'child_run', CONCAT('call-', i), REPEAT('a', 64), 2, 'res', 'background_shell', 'settled', i, i + 1
  FROM seq WHERE i <= $N"
# noise: NOISE other Sessions x 20 records in the same tenant, a quarter unsettled
Q $D -e "INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain,
  record_id, operation_hash, revision, record_resource_id, task_kind, task_state, created_at, settled_at)
  SELECT SHA2(CONCAT('t', CHAR(0), 's', i DIV 20), 256), SHA2(CONCAT('s', i DIV 20, CHAR(0), 'child_run', CHAR(0), 'r', i), 256),
  't', 'w', CONCAT('s', i DIV 20), 'child_run', CONCAT('r', i), REPEAT('a', 64), 2, 'res', 'background_shell', 'running', i,
  IF(i MOD 4 = 0, NULL, i + 1) FROM seq WHERE i <= $NOISE * 20"
Q $D -e "ANALYZE TABLE qwen_tool_execution, qwen_managed_session_extension_record" >/dev/null
PR="SELECT 1 FROM qwen_tool_execution e JOIN qwen_managed_session_extension_record r ON r.tenant_id = 't'
 AND r.session_id = e.harness_session_id AND r.domain = 'child_run'
 WHERE e.binding_id = 'b1' AND e.runtime_generation = 1
 AND CAST(e.binding_id AS BINARY(2048)) = CAST('b1' AS BINARY(2048))
 AND CAST(RIGHT(e.execution_call_id, 8) AS BINARY(8)) = CAST(':process' AS BINARY(8))
 AND CAST(r.tenant_id AS BINARY(2048)) = CAST('t' AS BINARY(2048))
 AND CAST(r.workspace_id AS BINARY(2048)) = CAST('w' AS BINARY(2048))
 AND CAST(r.session_id AS BINARY(2048)) = CAST(e.harness_session_id AS BINARY(2048))
 AND CAST(r.domain AS BINARY(2048)) = CAST('child_run' AS BINARY(2048))
 AND CAST(r.task_kind AS BINARY(2048)) = CAST('background_shell' AS BINARY(2048))
 AND r.settled_at IS NULL LIMIT 1"
# same predicates, but each distinct owning Session is looked up once (derived table)
ALT="SELECT 1 FROM (SELECT DISTINCT e.harness_session_id h FROM qwen_tool_execution e
 WHERE e.binding_id = 'b1' AND e.runtime_generation = 1
 AND CAST(e.binding_id AS BINARY(2048)) = CAST('b1' AS BINARY(2048))
 AND CAST(RIGHT(e.execution_call_id, 8) AS BINARY(8)) = CAST(':process' AS BINARY(8))) s
 JOIN qwen_managed_session_extension_record r ON r.tenant_id = 't' AND r.session_id = s.h AND r.domain = 'child_run'
 WHERE CAST(r.tenant_id AS BINARY(2048)) = CAST('t' AS BINARY(2048))
 AND CAST(r.workspace_id AS BINARY(2048)) = CAST('w' AS BINARY(2048))
 AND CAST(r.session_id AS BINARY(2048)) = CAST(s.h AS BINARY(2048))
 AND CAST(r.domain AS BINARY(2048)) = CAST('child_run' AS BINARY(2048))
 AND CAST(r.task_kind AS BINARY(2048)) = CAST('background_shell' AS BINARY(2048))
 AND r.settled_at IS NULL LIMIT 1"
echo "## [$DB] N=$N background Shells in one Session (2N execution rows on the binding, N settled records); noise=$((NOISE*20)) records in $NOISE other Sessions"
EX=$(Q $D -e 'SELECT COUNT(*) FROM qwen_tool_execution'); RC=$(Q $D -e 'SELECT COUNT(*) FROM qwen_managed_session_extension_record')
echo "rows: executions=$EX records=$RC"
[ "$EX" = "$((2 * N))" ] && [ "$RC" = "$((N + NOISE * 20))" ] || { echo "FAILED: fixture row counts are wrong"; exit 1; }
echo "--- EXPLAIN (PR query)"; Q $D -t -e "EXPLAIN $PR" | sed 's/^/  /'
t() { local best=999999 s e ms; for k in 1 2 3; do s=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000'); out=$(Q $D -e "$1"); e=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000'); ms=$((e-s)); [ $ms -lt $best ] && best=$ms; done; echo "$best ms (best of 3), result=[${out:-empty}]"; }
echo "PR query (JOIN per execution row): $(t "$PR")"
echo "same predicates, distinct Session first: $(t "$ALT")"
echo "baseline round trip (SELECT 1): $(t 'SELECT 1')"
if [ "$DB" = mysql ]; then echo "--- EXPLAIN ANALYZE (PR query)"; Q $D -e "EXPLAIN ANALYZE $PR" | perl -pe 's/\\n/\n/g' | grep -v "^\s*$" | cut -c1-240 | sed 's/^/  /'; fi
[ -n "$KEEP" ] || Q -e "DROP DATABASE $D"
echo "## done"
