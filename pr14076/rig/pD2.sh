#!/bin/bash
# D2 (Stage F: cancel during settlement): release the held subagent at t0 and POST the cancel at t0+OFFSET ms
#    (negative = cancel first). One line of outcome per run.  usage: pD2.sh <db> <id> <offsetMs> [kind]
DB=$1; ID=$2; OFF=$3; KIND=${4:-workflow}; source ./lib.sh
if [ "$KIND" = workflow ]; then P=$(newp "PARENT::wfbg::$ID::hold Run the workflow."); HK=${ID}h; TK=workflow; else P=$(newp "PARENT::bg::$ID::hold Launch."); HK=$ID; TK=child_agent; fi
for i in $(seq 120); do grep -q "child-holding\",\"child\":\"CHILD::hold::${HK}\"" runs/model-requests.jsonl 2>/dev/null && break; sleep 1; done
sleep 3; T=$(ktask $P $TK); C=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id='$P'")
before=$(tstate $P $T)
if [ "$OFF" -lt 0 ]; then
  R=$(node client.mjs $DB taskcancelk $P $T k-$ID-1); python3 -c "import time; time.sleep($((-OFF))/1000)"; release $HK >/dev/null
else
  release $HK >/dev/null; python3 -c "import time; time.sleep($OFF/1000)"; R=$(node client.mjs $DB taskcancelk $P $T k-$ID-1)
fi
code=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d['json'].get('status') or d['json'].get('error',{}).get('code'))")
for i in $(seq 90); do st=$(tstate $P $T); [[ "$st" =~ ^(cancelled|completed|failed) ]] && break; sleep 1; done
for i in $(seq 60); do op=$(sq "SELECT CONCAT(state,'/',IFNULL(error_code,'-')) FROM managed_agent_operation WHERE session_id='$P'"); [[ -z "$op" || "$op" =~ ^(COMPLETED|FAILED|RECOVERY) ]] && break; sleep 1; done
for i in $(seq 40); do n=$(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$P'"); [ "$n" -ge 2 ] && [[ "$(lastturn $P)" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 1; done
stop=$(sq "SELECT IF(JSON_EXTRACT(CAST(inline_bytes AS CHAR),'\$.body.stopRequested')=true,'stop','-') FROM qwen_managed_session_resource WHERE 1=0")
wake=$(grep "PARENT::$([ $KIND = workflow ] && echo wfbg || echo bg)::$ID::" runs/model-requests.jsonl | python3 -c "
import sys,json
w=[json.loads(l) for l in sys.stdin if '\"parent-wake\"' in l]
print(len(w), (w[-1]['reply'][len('PARENT_WAKE::'):] if w else '-')[:150].split('saw=')[-1])")
printf "   off=%6sms kind=%-11s before=%-18s cancel=%-34s task=%-14s op=%-28s child=%-12s parentTurns=%s wakes=%s\n" "$OFF" "$KIND" "$before" "$code" "$st" "${op:-none}" "$(lastturn $C)" "$(sq "SELECT GROUP_CONCAT(status ORDER BY created_at) FROM managed_agent_turn WHERE session_id='$P'")" "$wake"
