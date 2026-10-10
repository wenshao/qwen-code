#!/bin/bash
# usage: probe11.sh <db> <tag> — round 4 (main df72e2d1): #13829's new answer routes across #13769's agent wait
#   S7c  S7's window ([fg, bg] batch, the bg started receipt lost with the Harness), then CANCEL the Turn while the Harness is down
#   S11  [fg A, fg B]; A folds live, B's admission commit is lost with the Harness (B never admitted); the Turn continues
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hstop() { echo "   $(date -u +%T) harness stop"; node stack.mjs stop $DB harness 2>&1 | tail -1; }
hstart() { node stack.mjs harness $DB 2>&1 | tail -1; for i in $(seq 60); do curl -s -o /dev/null --noproxy '*' http://127.0.0.1:$HP/health && break; sleep 1; done; echo "   $(date -u +%T) harness back"; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
answers() { python3 msgs.py $DB $1 400 | grep "RESULT" | grep "$2" | sed 's/^/   answer  /' | cut -c1-330; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null

echo "== S7c [fg agent, bg agent(held child)] batch; the bg started receipt lost with the Harness; cancel while the Harness is down"
arm_store "marker=functionResponse%26%26call_${T}s7c_bg" > /dev/null
P=$(newp "PARENT::fgbg::${T}s7c::hold fg then bg child, receipt lost, then cancel."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $SCTL ${T}s7c)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; e=[x for x in h if '${T}s7c' in x['marker']]; print('   HELD', e[-1]['at'], '|', e[-1]['snippet'][150:470].replace(chr(10),' ')) if e else print('   NOT HELD')"
ledger $P; results $P
hstop; TID=$(lastturnid $P); echo "   $(date -u +%T) cancel: $(node client.mjs $DB cancel $P $TID | cut -c1-100)"; sleep 2
hstart; T0=$(date +%s)
for i in $(seq 90); do s=$(lastturn $P); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done
echo "   +$(( $(date +%s) - T0 )) s after restart: parent turn = $(lastturn $P); bg child still held"; turns $P
results $P; answers $P call_${T}s7c_
release ${T}s7cb; sleep 20
echo "   after releasing the bg child:"; turns $P; ledger $P; results $P; msgs $P 400 | grep -E "CALL|RESULT|model text" | cut -c1-300
hlog "cancel\|abandon\|interrupted" 4; modelsaw "${T}s7c" 300
next $P ${T}s7cn

echo "== S11 [fg A, fg B]; A folds live, B's admission commit lost with the Harness (B never admitted)"
arm_store "marker=child_run%26%26call_${T}s11_b" > /dev/null
P=$(newp "PARENT::fgfg::${T}s11::reply two foreground children, B's admission lost."); echo "   parent $P"
for i in $(seq 240); do [ "$(heldn $SCTL call_${T}s11_b)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], h[-1]['path'][-40:], '|', h[-1]['snippet'][200:560].replace(chr(10),' ')) if h else print('   NOT HELD')"
ledger $P; results $P; ckpts $P 2
restart
echo "   interrupted turn: $(waitterm $P 180)"; turns $P; ledger $P; kids $P; results $P; answers $P call_${T}s11_
msgs $P 400 | grep -E "CALL|RESULT|model text" | cut -c1-300; modelsaw "${T}s11" 300
hlog "s11\|recover\|interrupted" 4
next $P ${T}s11n
echo "== $(date -u +%T) probe11 DONE"
