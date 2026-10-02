#!/bin/bash
# SEAM (PR #13084 rig, from the #13087 retire.sh): the public/WebShell close, archive and DELETE refuse every
# Workspace Session (409 workspace_unavailable: ManagedAgentService.requireLegacyWorkspace, ManagedAgentStore.beginOperation).
# Write the operation row + pending status exactly as beginOperation writes them (the "requested" event is not appended),
# then let the production SessionLifecycleCoordinator (1 s scan) claim it: settle() -> completeOperation() [-> retire()].
# usage: DB=.. op.sh <sessionId> <CLOSE|DELETE|ARCHIVE> [waitSeconds (default 60, 0 = do not wait)]
R=$(cd $(dirname $0); pwd); S=$1; K=$2; W=${3:-60}; OP=${OPID:-op_rig_$(openssl rand -hex 8)}
NOW=$(/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node -e 'console.log(Date.now())')
case $K in CLOSE) PS=CLOSING;; DELETE) PS=DELETING;; ARCHIVE) PS=ARCHIVED;; *) echo "bad kind $K"; exit 2;; esac
if [ $K = ARCHIVE ]; then ST=COMPLETED; DS=CONFIRMED; RC="'rcpt_rig_$OP'"; CA=$NOW; else ST=PENDING; DS=PENDING; RC=NULL; CA=NULL; fi
$R/sql.sh -N -e "START TRANSACTION;
SELECT status INTO @before FROM managed_agent_session WHERE tenant_id='t-o41' AND session_id='$S' FOR UPDATE;
INSERT INTO managed_agent_operation (tenant_id, session_id, operation_id, operation_kind, actor_digest, idempotency_key, request_digest, state, admission_stage, delivery_state, session_status_before, receipt_id, available_at, created_at, updated_at, completed_at)
 SELECT tenant_id, session_id, '$OP', '$K', 'rig-seam', '$OP', 'rig-seam', '$ST', 'JAVA_DURABLE', '$DS', status, $RC, $NOW, $NOW, $NOW, $CA FROM managed_agent_session WHERE tenant_id='t-o41' AND session_id='$S' AND status IN ('ACTIVE','CLOSED','ARCHIVED');
UPDATE managed_agent_session SET status='$PS', version=version+1, updated_at=$NOW WHERE tenant_id='t-o41' AND session_id='$S' AND ROW_COUNT() = 1;
COMMIT;"
echo "op $OP $K session=$S inserted_at=$NOW"
[ "$W" = 0 ] && exit 0
for i in $(seq 1 $((W*4))); do st=$($R/sql.sh -N -e "SELECT state FROM managed_agent_operation WHERE operation_id='$OP'"); [ "$st" = "COMPLETED" ] && break; sleep 0.25; done
echo "op $OP state=$st attempts=$($R/sql.sh -N -e "SELECT attempt_count FROM managed_agent_operation WHERE operation_id='$OP'") session=$($R/sql.sh -N -e "SELECT status FROM managed_agent_session WHERE session_id='$S'") head=$($R/sql.sh -N -e "SELECT CONCAT(state,' writer=',IFNULL(writer_id,'-')) FROM qwen_managed_session_journal_head WHERE session_id='$S'") retirement=$($R/sql.sh -N -e "SELECT CONCAT('op=',operation_id,' gen=',generation,' protected=',recovery_protected) FROM qwen_output_session_retirement WHERE session_id='$S'" 2>/dev/null) after_ms=$(( $(/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node -e 'console.log(Date.now())') - NOW ))"
