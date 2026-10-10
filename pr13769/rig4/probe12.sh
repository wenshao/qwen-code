#!/bin/bash
# usage: probe12.sh <db> <tag> — round 4 (main df72e2d1): #13823's public task cancel aimed at #13769's foreground wait
#   S12a  the parent waits live on a held fg child; public task cancel of that child's task
#   S12b  the same wait, Harness stopped first; the cancel is admitted while the Harness is down, then the Harness restarts
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hstop() { echo "   $(date -u +%T) harness stop"; node stack.mjs stop $DB harness 2>&1 | tail -1; }
hstart() { node stack.mjs harness $DB 2>&1 | tail -1; for i in $(seq 60); do curl -s -o /dev/null --noproxy '*' http://127.0.0.1:$HP/health && break; sleep 1; done; echo "   $(date -u +%T) harness back"; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
opstate() { node client.mjs $DB op $1 $2 | python3 -c "import sys,json; j=json.load(sys.stdin); o=j['json']; print(j['status'], o.get('status'), o.get('delivery_state'), o.get('failure_code'), o.get('receipt_id')) if isinstance(o,dict) else print(j)"; }
opwait() { local s; for i in $(seq ${3:-60}); do s=$(opstate $1 $2); [[ "$s" =~ (completed|failed|recovery_blocked) ]] && break; sleep 2; done; echo "$s"; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null

for S in a b; do
  echo "== S12$S the parent waits on a held fg child; public task cancel of the child's task$([ $S = b ] && echo ' while the Harness is down, then restart')"
  P=$(newp "PARENT::fg::${T}s12$S::hold one foreground child, then cancel its task."); echo "   parent $P"
  for i in $(seq 120); do grep -q "CHILD::hold::${T}s12$S" runs/model-requests.jsonl 2>/dev/null && break; sleep 0.5; done
  sleep 2; ledger $P; ckpts $P 1
  TK=$(node client.mjs $DB fgtask $P); echo "   fg task $TK"
  [ $S = b ] && hstop
  T0=$(date +%s)
  R=$(node client.mjs $DB taskcancel $P $TK); echo "   $(date -u +%T) taskcancel: $(echo "$R" | cut -c1-260)"
  OP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['json'].get('id',''))" 2>/dev/null)
  if [ $S = b ]; then sleep 8; echo "   op while the Harness is down: $(opstate $P $OP)"; hstart; fi
  echo "   op: $(opwait $P $OP 90)  (+$(( $(date +%s) - T0 )) s)"
  echo "   parent turn: $(waitterm $P 120)  (+$(( $(date +%s) - T0 )) s)"
  sleep 3; turns $P; ledger $P; kids $P; results $P
  msgs $P 400 | grep -E "CALL|RESULT|model text" | cut -c1-320
  modelsaw "${T}s12$S" 260
  release ${T}s12$S > /dev/null
  hlog "cancel\|stop" 3
  next $P ${T}s12${S}n
done
echo "== $(date -u +%T) probe12 DONE"
