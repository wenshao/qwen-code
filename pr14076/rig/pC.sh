#!/bin/bash
# C: one parent owns a background child_agent task and a background workflow task.
#    Hold the child_agent cancel's delivery at the Spring->Harness proxy so its operation stays open,
#    then cancel the workflow task (cross-kind one-open rule) and reuse a key across tasks.  usage: pC.sh <db> <id>
DB=$1; ID=$2; source ./lib.sh
P=$(newp "PARENT::wfagbg::$ID::x Run both."); echo "== C [$DB] parent $P"
for i in $(seq 120); do n=$(grep -c -E "child-holding\",\"child\":\"CHILD::hold::${ID}(a|h)" runs/model-requests.jsonl 2>/dev/null); [ "$n" -ge 2 ] && break; sleep 1; done
sleep 4; TA=$(ktask $P child_agent); TW=$(ktask $P workflow)
echo "   child_agent $TA: $(tstate $P $TA)"; echo "   workflow    $TW: $(tstate $P $TW)"
echo "   arm proxy: $(arm_h 'mode=hold&body=%22kind%22%3A%22cancel%22&count=1')"
echo "   $(date -u +%T) cancel child_agent kA -> $(node client.mjs $DB taskcancelk $P $TA k-$ID-A | cut -c1-170)"
sleep 3; ops $P
echo "   $(date -u +%T) cancel workflow kW -> $(node client.mjs $DB taskcancelk $P $TW k-$ID-W | cut -c1-200)"
echo "   $(date -u +%T) cancel workflow with kA (other task, same key) -> $(node client.mjs $DB taskcancelk $P $TW k-$ID-A | cut -c1-200)"
echo "   $(date -u +%T) webshell cancel workflow kW2 -> $(node client.mjs $DB wscancel $P $TW k-$ID-W2 | cut -c1-200)"
echo "   $(date -u +%T) disarm: $(disarm_h)"
for i in $(seq 90); do s=$(sq "SELECT state FROM managed_agent_operation WHERE session_id='$P' AND idempotency_key='k-$ID-A'"); [ "$s" = COMPLETED ] || [ "$s" = FAILED ] && break; sleep 1; done
echo "   $(date -u +%T) child_agent op -> $s after ${i}s; agent task -> $(tstate $P $TA)"
echo "   $(date -u +%T) cancel workflow kW (retry) -> $(node client.mjs $DB taskcancelk $P $TW k-$ID-W | cut -c1-200)"
for i in $(seq 60); do s=$(tstate $P $TW); [[ "$s" =~ ^cancelled ]] && break; sleep 1; done
echo "   $(date -u +%T) workflow task -> $s after ${i}s"
sleep 3; turns $P; ledger $P; ops $P
echo "   proxy log:"; flog 8 300 | sed 's/^/     /'
release ${ID}a; release ${ID}h
