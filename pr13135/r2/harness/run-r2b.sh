#!/bin/bash
# PR #13135 round 2: F2 (Spring SIGKILL mid-close), F3 (TERM restart into approval mode) + approval refusal, on DB l2.
R=/Users/wenshao/pr13135-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export DB=l2 BASE=http://127.0.0.1:18136 ARM=head2 RUNDIR=$R/run/lx-l2 STATE=broker
cd $R/probe
echo "=== F2 $(date -u +%T)"
$N prep.mjs c1 wsc g
S=$(node -e "console.log(require('$R/out/l2/prep-c1.json')[0].session)"); P=$(node -e "console.log(require('$R/out/l2/prep-c1.json')[0].pid)")
echo "[{\"match\":\"DELETE /session/$S\",\"action\":\"delay\",\"delayMs\":20000}]" > $R/run/lx-l2/tap-rules.json
curl -s -X POST -H 'X-Qwen-Tenant-Id: t-rig' -H 'X-Rig-Actor: alice' -H 'Idempotency-Key: close-F2' http://127.0.0.1:18136/v1/agents/sessions/$S/close | cut -c1-120; echo
sleep 3; echo "session at kill: $($R/q.sh l2 "select status from managed_agent_session where session_id='$S'" | tail -1)"
$R/lxx.sh "kill -9 \$(cat /var/rig/run/l2/spring.pid); sleep 1; [ -d /proc/$P ] && echo worker-$P-alive-after-spring-kill || echo worker-$P-gone"
echo '[]' > $R/run/lx-l2/tap-rules.json
$R/lxx.sh "$R/lx/spring.sh head2 l2 2>&1 | tail -1" | sed 's/^/restart: /'
T0=$(date +%s); for i in $(seq 1 120); do st=$($R/q.sh l2 "select status from managed_agent_session where session_id='$S'" | tail -1); [ "$st" = CLOSED ] && break; sleep 2; done
echo "F2 session=$st after $(( $(date +%s) - T0 ))s from restart; op=$($R/q.sh l2 "select state, coalesce(error_code,''), attempt_count from managed_agent_operation where session_id='$S' order by created_at desc limit 1" | tail -1 | tr '\t' ' '); worker $P: $($R/lxx.sh "[ -d /proc/$P ] && echo alive || echo gone"); binding=$($R/q.sh l2 "select binding_state, length(drain_receipt_json) from qwen_runtime_binding where isolation_key='$S'" | tail -1 | tr '\t' ' ')"
echo "F2 replay: $(curl -s -X POST -H 'X-Qwen-Tenant-Id: t-rig' -H 'X-Rig-Actor: alice' -H 'Idempotency-Key: close-F2' http://127.0.0.1:18136/v1/agents/sessions/$S/close | cut -c1-140)"
echo "=== F3 $(date -u +%T)"
$N prep.mjs r1 wsr h,i
$R/lxx.sh "$R/lx/stop.sh l2 spring TERM; MODE=default DIST=head2 $R/lx/spring.sh head2 l2 2>&1 | tail -1"
$N closeall.mjs r1 F3-spring-term-restart 120000 completed 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-220
echo "=== approval $(date -u +%T)"
$N s5-approval.mjs wsap-k k 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)"
echo RUN-R2B-DONE $(date -u +%T)
