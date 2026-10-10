#!/bin/bash
# usage: probe2.sh <db> <tag> — the /review R1 Criticals on the real stack (run under bash)
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }

echo "== S5 (R1-21) recovered wait (point 1), then the continued Turn's shell round"
delay 25
P=$(newp "PARENT::fgsh::${T}s5::reply recovered wait then a shell round."); echo "   parent $P"
for i in $(seq 60); do [ "$(childruns $P)" -ge 1 ] && break; sleep 0.5; done; echo "   child_run admitted"
restart; delay 0
echo "   interrupted turn: $(waitterm $P 150)"; turns $P; ledger $P; results $P; modelsaw "${T}s5"
grep -n "prior activation\|cannot continue\|ManagedSessionConflict" runs/$DB/harness.log | grep -v "^$" | tail -3 | cut -c1-260 | sed 's/^/   hlog    /'
next $P ${T}s5b

echo "== S6 (R1-1) live fold, then a crash in the shell round before commitAwaitRuntimeBatch (Broker prepare held)"
arm_broker "path=executions:prepare" > /dev/null
P=$(newp "PARENT::fgsh::${T}s6::reply live fold then a shell round lost mid-prepare."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $BCTL executions:prepare)" -ge 1 ] && break; sleep 0.5; done
held_broker | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], h[-1]['path']) if h else print('   NOT HELD')"
results $P
restart
echo "   interrupted turn: $(waitterm $P 150)"; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT"; modelsaw "${T}s6"
ls -la runs/$DB/workspace/parent-${T}s6.txt 2>&1 | sed 's/^/   file    /'
next $P ${T}s6b

echo "== S7 (R1-24) [fg agent, bg agent] batch; crash before the bg started receipt commits"
arm_store "marker=functionResponse%26%26call_${T}s7_bg" > /dev/null
P=$(newp "PARENT::fgbg::${T}s7::hold fg then bg child, receipt lost."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $SCTL ${T}s7)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; e=[x for x in h if '${T}s7' in x['marker']]; print('   HELD', e[-1]['at'], '|', e[-1]['snippet'][150:470].replace(chr(10),' ')) if e else print('   NOT HELD')"
ledger $P
restart
for i in $(seq 25); do sleep 2; done; echo "   $(date -u +%T) 50 s after restart, background child still held: parent turn = $(lastturn $P)"; turns $P
release ${T}s7b
echo "   interrupted turn: $(waitterm $P 120)"; sleep 5; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT"; modelsaw "${T}s7"
next $P ${T}s7c
echo "== $(date -u +%T) probe2 DONE"
