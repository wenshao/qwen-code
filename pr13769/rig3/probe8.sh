#!/bin/bash
# usage: probe8.sh <db> <tag> <n1|n2|n3|n4> — round 3: the round-2 self-review findings on the real stack
#   n1 (R2-1) live fold, crash while the parent's next model call is in flight, continued Turn runs a shell round
#   n2 (R2-3) recovered fg wait (child model call across the restart), continued Turn issues a SECOND fg agent call
#   n3 (R2-2) [fg A, fg B(hold)]: B admitted, B's wait commit lost, Harness down, cancel; time the cancelled settle
#   n4 (R2-9) n1's window plus 3 injected 503s on the adoption's checkpoint read (SKIP= reads let through first)
DB=$1; T=$2; S=$3; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hstop() { echo "   $(date -u +%T) harness stop"; node stack.mjs stop $DB harness 2>&1 | tail -1; }
hstart() { node stack.mjs harness $DB 2>&1 | tail -1; for i in $(seq 60); do curl -s -o /dev/null --noproxy '*' http://127.0.0.1:$HP/health && break; sleep 1; done; echo "   $(date -u +%T) harness back"; }
holding() { grep -c "parent-fgshh-holding.*$1" runs/model-requests.jsonl 2>/dev/null; }
acq() { grep -c 'tool-sessions:acquire' runs/$DB/bproxy.jsonl 2>/dev/null; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null; curl -s http://127.0.0.1:$BCTL/disarm > /dev/null
case $S in
n1|n4)
  echo "== $S ($([ $S = n1 ] && echo R2-1 || echo R2-9)) live fold, then a crash while the parent's next model call is in flight"
  P=$(newp "PARENT::fgshh::${T}${S}::reply live fold then the next model call across the restart."); echo "   parent $P"
  for i in $(seq 120); do [ "$(holding ${T}${S})" -ge 1 ] && break; sleep 0.5; done; echo "   $(date -u +%T) round-2 model call held (after the live fold)"
  sleep 2; echo "   before the crash:"; results $P; ckpt $P
  hstop; release ${T}${S}m
  if [ $S = n4 ]; then
    RID=$(ckptrid $P); echo "   checkpoint resource $RID; arming 3 x 503 on its reads after the first one that follows execution:authorize"
    curl -s "http://127.0.0.1:$SCTL/fault?method=GET&path=$RID&skip=${SKIP:-1}&fail=3&afterPath=execution:authorize"
  fi
  A0=$(acq); hstart
  echo "   interrupted turn: $(waitterm $P 180)"; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT|model text"; modelsaw "${T}${S}" 300; ckpts $P 8
  [ $S = n4 ] && curl -s "http://127.0.0.1:$SCTL/faults" | cut -c1-600
  find runs/$DB -name "parent-${T}${S}.txt" | sed 's/^/   file    /'; echo "   broker acquires after restart: $(( $(acq) - A0 ))"
  hlog "prior activation\|did not adopt\|recovery_required\|Recovered agent wait\|failed:" 6
  if [ $S = n4 ]; then echo "   (n4: no next turn here; probe8b.sh does the second restart)"; else next $P ${T}${S}c; fi ;;
n2)
  echo "== n2 (R2-3) recovered fg wait (child model call held across the restart), then a second fg agent call"
  P=$(newp "PARENT::fgag::${T}n2::hold recovered wait then a second foreground child."); echo "   parent $P"
  for i in $(seq 60); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done; echo "   child turn running"
  A0=$(acq); restart; release ${T}n2
  echo "   interrupted turn: $(waitterm $P 180)"; turns $P; ledger $P; results $P; msgs $P 260 | grep -E "CALL|RESULT|model text"; modelsaw "${T}n2" 320
  echo "   broker acquires after restart: $(( $(acq) - A0 ))"
  hlog "Workspace mount\|unavailable while\|failed:" 4
  next $P ${T}n2c ;;
n3)
  echo "== n3 (R2-2) [fg A, fg B(held child)]; B admitted, B's wait commit lost; cancel while the Harness is down"
  arm_store "marker=agentWait%26%26call_${T}n3_b" > /dev/null
  P=$(newp "PARENT::fgfg::${T}n3::hold two foreground children, B's wait commit lost, then cancel."); echo "   parent $P"
  for i in $(seq 240); do [ "$(heldn $SCTL call_${T}n3_b)" -ge 1 ] && break; sleep 0.5; done
  held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], h[-1]['path'][-40:], '|', h[-1]['snippet'][200:520].replace(chr(10),' ')) if h else print('   NOT HELD')"
  ledger $P; results $P
  hstop; TID=$(lastturnid $P); echo "   $(date -u +%T) cancel: $(node client.mjs $DB cancel $P $TID | cut -c1-100)"; sleep 2
  hstart; T0=$(date +%s)
  for i in $(seq 60); do s=$(lastturn $P); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done
  echo "   +$(( $(date +%s) - T0 )) s after restart: parent turn = $(lastturn $P); B child still held"; turns $P
  if ! [[ "$(lastturn $P)" =~ ^(COMPLETED|FAILED|CANCELLED) ]]; then
    release ${T}n3b; T1=$(date +%s); s=$(waitterm $P 90); echo "   +$(( $(date +%s) - T1 )) s after releasing B's child: $s"
  else release ${T}n3b; fi
  sleep 4; turns $P; ledger $P; results $P; msgs $P 220 | grep -E "CALL|RESULT"
  hlog "cancel\|abandon" 4
  next $P ${T}n3c ;;
esac
echo "== $(date -u +%T) probe8 $S DONE"
