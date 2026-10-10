#!/bin/bash
# usage: probe12c.sh <db> <tag> — round 4 (main df72e2d1): #13823's public task cancel aimed at #13769's foreground wait
#   S12c  child creation delayed 45 s so the child starts only after the restart; Harness stopped while the parent waits;
#         the cancel is admitted while the Harness is down and must reach a LIVE child through the recovered wait
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hstop() { echo "   $(date -u +%T) harness stop"; node stack.mjs stop $DB harness 2>&1 | tail -1; }
hstart() { node stack.mjs harness $DB 2>&1 | tail -1; for i in $(seq 60); do curl -s -o /dev/null --noproxy '*' http://127.0.0.1:$HP/health && break; sleep 1; done; echo "   $(date -u +%T) harness back"; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
opstate() { node client.mjs $DB op $1 $2 | python3 -c "import sys,json; j=json.load(sys.stdin); o=j['json']; print(j['status'], o.get('status'), o.get('delivery_state'), o.get('failure_code'), o.get('receipt_id')) if isinstance(o,dict) else print(j)"; }
opwait() { local s; for i in $(seq ${3:-60}); do s=$(opstate $1 $2); [[ "$s" =~ (completed|failed|recovery_blocked) ]] && break; sleep 2; done; echo "$s"; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null

S=c
echo "== S12c fg child admitted, creation held 45 s; Harness stopped while the parent waits; public task cancel while down; restart"
delay 45
P=$(newp "PARENT::fg::${T}s12c::hold one foreground child created after the restart, then cancel its task."); echo "   parent $P"
for i in $(seq 120); do [ -n "$(sq "SELECT record_id FROM qwen_managed_session_extension_record WHERE session_id='$P' AND domain='child_run'")" ] && break; sleep 0.5; done
sleep 3; ledger $P; kids $P; ckpts $P 1
TK=$(node client.mjs $DB fgtask $P); echo "   fg task $TK"
hstop; T0=$(date +%s)
R=$(node client.mjs $DB taskcancel $P $TK); echo "   $(date -u +%T) taskcancel: $(echo "$R" | cut -c1-200)"
OP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['json'].get('id',''))" 2>/dev/null)
sleep 5; echo "   op while the Harness is down: $(opstate $P $OP)"; hstart; delay 0
for i in $(seq 90); do grep -q "\"role\":\"child\",\"child\":\"CHILD::hold::${T}s12c" runs/model-requests.jsonl 2>/dev/null && { echo "   $(date -u +%T) child model call held (+$(( $(date +%s) - T0 )) s)"; break; }; s=$(lastturn $P); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done
echo "   op: $(opwait $P $OP 120)  (+$(( $(date +%s) - T0 )) s)"
echo "   parent turn: $(waitterm $P 150)  (+$(( $(date +%s) - T0 )) s)"
sleep 3; turns $P; ledger $P; kids $P; results $P
msgs $P 400 | grep -E "CALL|RESULT|model text" | cut -c1-320
modelsaw "${T}s12c" 260
release ${T}s12c > /dev/null
hlog "cancel\|children/operations" 6
next $P ${T}s12cn
echo "== $(date -u +%T) probe12c DONE"
