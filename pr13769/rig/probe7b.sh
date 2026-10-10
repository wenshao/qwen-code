#!/bin/bash
# usage: probe7.sh <db> <tag> — S7 (R1-24) alone on a fresh stack
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
echo "== S7 (R1-24) [fg agent, bg agent] batch; crash before the bg started receipt commits"
arm_store "marker=functionResponse%26%26call_${T}s7_bg" > /dev/null
P=$(newp "PARENT::fgbg::${T}s7::hold fg then bg child, receipt lost."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $SCTL ${T}s7)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; e=[x for x in h if '${T}s7' in x['marker']]; print('   HELD', e[-1]['at'], '|', e[-1]['snippet'][150:470].replace(chr(10),' ')) if e else print('   NOT HELD')"
ledger $P
restart
for i in $(seq 75); do sleep 2; done; echo "   $(date -u +%T) 150 s after restart, background child still held: parent turn = $(lastturn $P)"; turns $P
release ${T}s7b
echo "   interrupted turn: $(waitterm $P 120)"; sleep 5; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT"; modelsaw "${T}s7"
next $P ${T}s7c
echo "== $(date -u +%T) probe7b DONE"
