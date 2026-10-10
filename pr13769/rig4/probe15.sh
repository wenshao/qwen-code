#!/bin/bash
# usage: probe15.sh <db> <tag> — round 4c classification: the same wake race on an ordinary Runtime park (no agent wait)
#   S15  round 1 launches a bg child that answers at once; round 2's shell call runs, and its Broker acknowledge is held (the Runtime park is past await_runtime), so the bg
#        completion notification lands in the parent's journal while the shell round is in flight; Harness restart
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
childreq() { grep "\"role\":\"child\",\"child\":\"CHILD::$1\"" runs/model-requests.jsonl 2>/dev/null | wc -l | tr -d ' '; }
pump() { echo "   wake-pump failures: $(grep -c 'wake pump of session '"$1"' failed' runs/$DB/harness.log)"; grep 'wake pump of session '"$1"' failed' runs/$DB/harness.log | head -2 | cut -c1-260 | sed 's/^/   hlog    /'; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null; curl -s http://127.0.0.1:$BCTL/disarm > /dev/null

echo "== S15 [bg answers at once] then a shell round whose Broker acknowledge is held; the bg notification lands meanwhile; restart"
arm_broker "path=:acknowledge" > /dev/null
P=$(newp "PARENT::bgsh::${T}s15::x bg child then a shell round, restart."); echo "   parent $P"
for i in $(seq 120); do [ "$(childreq reply::${T}s15b)" -ge 1 ] && [ "$(heldn $BCTL :acknowledge)" -ge 1 ] && break; sleep 0.5; done
echo "   bg child answered: $(childreq reply::${T}s15b); acknowledge held: $(heldn $BCTL :acknowledge)"
sleep 10; echo "   before the restart:"; turns $P; ledger $P; ckpts $P 1
restart; T0=$(date +%s)
echo "   interrupted turn: $(waitterm $P 200)  (+$(( $(date +%s) - T0 )) s)"
sleep 10; turns $P; ledger $P; results $P; pump $P
msgs $P 400 | grep -E "CALL|RESULT|model text|user text" | cut -c1-220
next $P ${T}s15n
echo "== $(date -u +%T) probe15 DONE"
