#!/bin/bash
# usage (in container): Lprobe.sh <db> <tag> — acceptance probe 3 (close/delete) on Linux
DB=$1; T=$2; . /rig/llib.sh
next() { node lclient.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
closeit() { echo "   $(date -u +%T) close: $(node lclient.mjs $DB close $1 | cut -c1-110)"; untilst parent "sst $1" ${2:-240} CLOSED; ops $1; ledger $1; kids $1; }
delit() { echo "   delete: $(node lclient.mjs $DB delete $1 | cut -c1-110)"; untilst parent "sst $1" 60 DELETED; }
fails() { grep "$1" /work/$DB/spring.log | grep -o "failure=.*" | cut -c1-150 | sort | uniq -c | sort -rn | head -3 | sed 's/^/   spring  /'; }

echo "== L0 sanity: foreground delegation, then close and delete"
P=$(newp "PARENT::fg::${T}l0::reply sanity."); echo "   parent $P"; echo "   turn: $(waitterm $P 60)"; closeit $P 60; delit $P

echo "== L1 (round-9 W1) restart during a foreground delegation (child held), then close and delete"
P=$(newp "PARENT::fg::${T}l1::hold foreground child held."); echo "   parent $P"
for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done
restart; release ${T}l1
echo "   interrupted turn: $(waitterm $P 150)"; turns $P; next $P ${T}l1b; ledger $P
closeit $P 240; delit $P; fails $P

echo "== L2 close sent right after the restart, while the foreground wait is still parked"
P=$(newp "PARENT::fg::${T}l2::hold foreground child held."); echo "   parent $P"
for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done
restart; closeit $P 300; release ${T}l2; turns $P; delit $P; fails $P

echo "== L3 cancellation takeover of the parked wait, then a next Turn, then close and delete"
P=$(newp "PARENT::fg::${T}l3::hold cancel-takeover child held."); echo "   parent $P"
for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done
echo "   $(date -u +%T) harness stop"; node lstack.mjs stop $DB harness 2>&1 | tail -1
TID=$(lastturnid $P); echo "   cancel: $(node lclient.mjs $DB cancel $P $TID | cut -c1-90)"; sleep 3
node lstack.mjs harness $DB 2>&1 | tail -1; echo "   $(date -u +%T) harness back"
echo "   interrupted turn: $(waitterm $P 150)"; release ${T}l3; next $P ${T}l3b; turns $P; ledger $P
closeit $P 240; delit $P; fails $P
echo "== $(date -u +%T) Lprobe DONE workers=$(W)"
