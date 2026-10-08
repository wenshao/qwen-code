#!/bin/bash
# Seed K clones of a real close_debt row, then time a fresh background child.
DB=${DB:-r6m}; K=${1:-200}; TAG=${2:-s1}; . /Users/wenshao/git/pr13550-rig/r3lib.sh
SRC=$(sq "SELECT CONCAT(parent_session_id,'|',child_run_id) FROM qwen_managed_child_result_relay WHERE state='close_debt' AND child_run_id NOT LIKE '%#dbt%' ORDER BY created_at LIMIT 1")
P=${SRC%%|*}; R=${SRC#*|}; echo "source parent=$P run=$R  K=$K"
if [ "$K" -gt 0 ]; then
./mysql.sh sql $DB <<SQL
SET SESSION cte_max_recursion_depth = 100000;
INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain, record_id, operation_hash, revision, record_resource_id, task_kind, task_state, runtime_state, definition_revision, delivery_target, delivery_state, created_at, started_at, settled_at, first_sequence)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < $K)
SELECT e.session_scope_key, SHA2(CONCAT(e.session_id, CHAR(0), 'child_run', CHAR(0), CONCAT(e.record_id, '#dbt$TAG', n)), 256), e.tenant_id, e.workspace_id, e.session_id, e.domain, CONCAT(e.record_id, '#dbt$TAG', n), e.operation_hash, e.revision, e.record_resource_id, e.task_kind, e.task_state, e.runtime_state, e.definition_revision, e.delivery_target, e.delivery_state, e.created_at, e.started_at, e.settled_at, e.first_sequence
FROM seq JOIN qwen_managed_session_extension_record e ON e.session_id='$P' AND e.domain='child_run' AND e.record_id='$R';
INSERT INTO qwen_managed_child_result_relay (tenant_id, parent_session_id, child_run_id, creation_key, child_session_id, state, claimed_by, claimed_until, attempts, next_retry_at, last_error, created_at, updated_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < $K)
SELECT l.tenant_id, l.parent_session_id, CONCAT(l.child_run_id, '#dbt$TAG', n), SHA2(CONCAT(l.parent_session_id, CHAR(0), 'child_run', CHAR(0), CONCAT(l.child_run_id, '#dbt$TAG', n)), 256), l.child_session_id, 'close_debt', l.claimed_by, l.claimed_until, 0, 0, l.last_error, l.created_at, l.updated_at
FROM seq JOIN qwen_managed_child_result_relay l ON l.parent_session_id='$P' AND l.child_run_id='$R';
SQL
fi
echo "close_debt rows now: $(sq "SELECT COUNT(*) FROM qwen_managed_child_result_relay WHERE state='close_debt'")"
sleep 12
T0=$(date +%s); U0=$(sq "SELECT COUNT(*) FROM qwen_managed_child_result_relay WHERE state='close_debt' AND updated_at > (UNIX_TIMESTAMP()-10)*1000")
echo "debt rows touched in the last 10 s: $U0"
./sc.sh $DB $TAG 60 "PARENT::bg::r6$TAG::reply fresh background child behind $K close debts." | tail -1
S=$(cat runs/$DB/$TAG.sid); T1=$(date +%s)
for i in $(seq 180); do
  c=$(sq "SELECT COUNT(*) FROM managed_agent_session WHERE parent_session_id='$S'")
  n=$(sq "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='$S' AND delivery_state='consumed'")
  [ -z "$CT" ] && [ "$c" -ge 1 ] && CT=$(( $(date +%s)-T1 ))
  [ "$n" -ge 2 ] && { echo "   child created after ${CT}s, both consumed after $(( $(date +%s)-T1 ))s"; break; }
  sleep 1
done
[ "$n" -ge 2 ] || echo "   NOT delivered within 180 s; child sessions=$c; ledger: $(sq "SELECT IFNULL(MAX(state),'(no ledger row)') FROM qwen_managed_child_result_relay WHERE parent_session_id='$S'"); record: $(sq "SELECT CONCAT(revision,' ',IFNULL(delivery_state,'-')) FROM qwen_managed_session_extension_record WHERE session_id='$S' AND domain='child_run'")"
echo "debt rows touched in the last 10 s: $(sq "SELECT COUNT(*) FROM qwen_managed_child_result_relay WHERE state='close_debt' AND updated_at > (UNIX_TIMESTAMP()-10)*1000")"
