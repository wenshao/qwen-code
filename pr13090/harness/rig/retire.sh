#!/bin/bash
# SEAM (PR #13087 rig): the public/WebShell DELETE refuses Workspace Sessions (409 workspace_unavailable,
# ManagedAgentService.requireLegacyWorkspace + ManagedAgentStore.beginOperation). Write the same DELETE
# operation row + DELETING status that beginOperation writes, then let the production
# SessionLifecycleCoordinator claim it and run completeOperation -> lockDeletion -> retire.
# usage: DB=.. retire.sh <sessionId>
R=$(cd $(dirname $0); pwd); S=$1; OP=op_rig_$(openssl rand -hex 8); NOW=$(node -e 'console.log(Date.now())')
$R/sql.sh -N -e "START TRANSACTION;
INSERT INTO managed_agent_operation (tenant_id, session_id, operation_id, operation_kind, actor_digest, idempotency_key, request_digest, state, admission_stage, delivery_state, session_status_before, receipt_id, available_at, created_at, updated_at, completed_at)
 SELECT tenant_id, session_id, '$OP', 'DELETE', 'rig-seam', '$OP', 'rig-seam', 'PENDING', 'JAVA_DURABLE', 'PENDING', status, NULL, $NOW, $NOW, $NOW, NULL FROM managed_agent_session WHERE tenant_id='t-rig' AND session_id='$S' AND status IN ('ACTIVE','CLOSED','ARCHIVED');
UPDATE managed_agent_session SET status='DELETING', version=version+1, updated_at=$NOW WHERE tenant_id='t-rig' AND session_id='$S' AND ROW_COUNT() = 1;
COMMIT;"
for i in $(seq 1 120); do st=$($R/sql.sh -N -e "SELECT state FROM managed_agent_operation WHERE operation_id='$OP'"); [ "$st" = "COMPLETED" ] && break; sleep 0.5; done
echo "retire $S op=$OP state=$st session=$($R/sql.sh -N -e "SELECT status FROM managed_agent_session WHERE session_id='$S'") retirement=$($R/sql.sh -N -e "SELECT CONCAT('gen=',generation,' retired_at=',retired_at,' recovery_protected=',recovery_protected) FROM qwen_output_session_retirement WHERE session_id='$S'")"
$R/sql.sh -N -e "SELECT CONCAT(LEFT(publication_id,8),' ',retention_state) FROM qwen_tool_publication WHERE session_id='$S'"
