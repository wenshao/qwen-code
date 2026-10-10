#!/bin/bash
# usage: probe1.sh <db> <tag> — #13708 acceptance probes on one stack (run under bash)
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }

echo "== S0 control: the parent's own model call in flight across a Harness restart (no child)"
P=$(newp "PARENT::phold::${T}s0::x parent model call held."); echo "   parent $P"
for i in $(seq 30); do [ "$(running $P)" = 1 ] && break; sleep 1; done
restart; release ${T}s0
echo "   interrupted turn: $(waitterm $P 120)"; turns $P; next $P ${T}s0b

echo "== S1 interruption point 1: restart after the admission, before the child exists (child creation held 25 s)"
delay 25
P=$(newp "PARENT::fg::${T}s1::reply point-1 child created after the restart."); echo "   parent $P"
for i in $(seq 60); do [ "$(childruns $P)" -ge 1 ] && break; sleep 0.5; done; echo "   child_run admitted"; ledger $P
restart; delay 0
echo "   interrupted turn: $(waitterm $P 120)"; turns $P; ledger $P; kids $P; results $P; modelsaw "${T}s1"
next $P ${T}s1b

echo "== S2 interruption point 1: the child's own model call in flight across the restart"
P=$(newp "PARENT::fg::${T}s2::hold point-1 child running across the restart."); echo "   parent $P"
for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done; echo "   child turn running"
restart; release ${T}s2
echo "   interrupted turn: $(waitterm $P 120)"; turns $P; ledger $P; kids $P; results $P; modelsaw "${T}s2"
next $P ${T}s2b


echo "== S4 cancellation takeover: cancel the parked Turn while the Harness is down"
P=$(newp "PARENT::fg::${T}s4::hold cancel-takeover child held."); echo "   parent $P"
for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done; echo "   child turn running"
echo "   $(date -u +%T) harness stop"; node stack.mjs stop $DB harness 2>&1 | tail -1
TID=$(lastturnid $P); echo "   cancel: $(node client.mjs $DB cancel $P $TID | cut -c1-120)"; sleep 3
node stack.mjs harness $DB 2>&1 | tail -1; echo "   $(date -u +%T) harness back"
echo "   interrupted turn: $(waitterm $P 120)"; release ${T}s4; sleep 3; turns $P; ledger $P; results $P; msgs $P 200 | grep -i "result\|cancel"
next $P ${T}s4b
echo "== $(date -u +%T) probe1 DONE"
