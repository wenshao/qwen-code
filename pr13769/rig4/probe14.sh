#!/bin/bash
# usage: probe14.sh <db> <tag> [s13b] — round 4c: a wake input that is already in the parent's journal when the Harness dies
#   during #13769's foreground wait. Does the wake pump start a model round before the parked Turn is continued?
#   S14   [bg (answers at once), fg (held)]: the bg completion notification lands while the fg wait is live; restart
#   S13b2 (main only, with arg s13b): S13b again - the child's message to its parent is handed over, the fold commit is lost
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
childreq() { grep "\"role\":\"child\",\"child\":\"CHILD::$1\"" runs/model-requests.jsonl 2>/dev/null | wc -l | tr -d ' '; }
pump() { echo "   wake-pump failures: $(grep -c 'wake pump of session '"$1"' failed' runs/$DB/harness.log)"; grep 'wake pump of session '"$1"' failed' runs/$DB/harness.log | head -2 | cut -c1-260 | sed 's/^/   hlog    /'; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null

echo "== S14 [bg answers at once, fg held]; the bg completion notification lands during the fg wait; Harness restart"
P=$(newp "PARENT::bgfg::${T}s14::hold bg answers, fg held, restart."); echo "   parent $P"
for i in $(seq 120); do [ "$(childreq reply::${T}s14b)" -ge 1 ] && [ "$(childreq hold::${T}s14f)" -ge 1 ] && break; sleep 0.5; done
sleep 10; echo "   before the restart:"; turns $P; ledger $P; ckpts $P 1
restart; T0=$(date +%s)
echo "   interrupted turn: $(waitterm $P 200)  (+$(( $(date +%s) - T0 )) s)"
release ${T}s14f > /dev/null; sleep 15
turns $P; ledger $P; results $P; pump $P
msgs $P 400 | grep -E "CALL|RESULT|model text|user text" | cut -c1-240
modelsaw "${T}s14" 200
next $P ${T}s14n

if [ "${3:-}" = s13b ]; then
echo "== S13b2 S13b again: fg child messages its parent, then answers; the parent's fold commit is lost with the Harness"
arm_store "marker=CHILD_RESULT::${T}s13b::after-tool%26%26functionResponse" > /dev/null
P=$(newp "PARENT::fg::${T}s13b::msg foreground child that messages its parent, fold lost."); echo "   parent $P"
for i in $(seq 240); do [ "$(heldn $SCTL ${T}s13b)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], '|', h[-1]['snippet'][200:420].replace(chr(10),' ')) if h else print('   NOT HELD')"
restart; T0=$(date +%s)
echo "   interrupted turn: $(waitterm $P 200)  (+$(( $(date +%s) - T0 )) s)"
turns $P; ledger $P; results $P; pump $P
next $P ${T}s13bn
fi
echo "== $(date -u +%T) probe14 DONE"
