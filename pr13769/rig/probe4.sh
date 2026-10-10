#!/bin/bash
# usage: probe4.sh <db> <tag> — clean R1-1 re-run on a fresh stack, with a shell control
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
echo "== C0 control: a plain shell round (no agent, no restart)"
P=$(newp "PARENT::sh::${T}c0::x shell control."); echo "   parent $P"; echo "   turn: $(waitterm $P 90)"; results $P; modelsaw "${T}c0" 200
find runs/$DB -name "parent-${T}c0.txt" | sed 's/^/   file    /'
echo "== S6 (R1-1) live fold, then a crash in the shell round before commitAwaitRuntimeBatch (Broker prepare held)"
arm_broker "path=executions:prepare" > /dev/null
P=$(newp "PARENT::fgsh::${T}s6::reply live fold then a shell round lost mid-prepare."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $BCTL executions:prepare)" -ge 1 ] && break; sleep 0.5; done
held_broker | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], h[-1]['path']) if h else print('   NOT HELD')"
echo "   before restart:"; results $P; msgs $P 160 | grep -E "CALL|RESULT"
restart
echo "   interrupted turn: $(waitterm $P 150)"; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT|model text"; modelsaw "${T}s6" 300
find runs/$DB -name "parent-${T}s6.txt" | sed 's/^/   file    /'; echo "   (file search done)"
next $P ${T}s6b
echo "== $(date -u +%T) probe4 DONE"
