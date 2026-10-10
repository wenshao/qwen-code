#!/bin/bash
# usage: probe5.sh <db> <tag> — admitted-orphan fill (S8) and the R1-23 replay window (S9)
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
heldsid() { curl -s "http://127.0.0.1:$SCTL/held" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin)['held'] if '$1' in x['path']))"; }
lastheld() { curl -s "http://127.0.0.1:$SCTL/held" | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], h[-1]['path'][-40:], '|', h[-1]['snippet'][:420].replace(chr(10),' ')) if h else print('   NOT HELD')"; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null

echo "== S8 admitted orphan: [fg A, fg B]; B admitted, B's wait commit lost (child creation held 25 s)"
delay 25
arm_store "marker=agentWait%26%26call_${T}s8_b" > /dev/null
P=$(newp "PARENT::fgfg::${T}s8::reply two foreground children, B's wait commit lost."); echo "   parent $P"
for i in $(seq 240); do [ "$(heldsid $P)" -ge 1 ] && break; sleep 0.5; done; lastheld
ledger $P; results $P
restart
echo "   interrupted turn: $(waitterm $P 180)"; delay 0; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT|model text"; modelsaw "${T}s8" 300
next $P ${T}s8c

echo "== S9 R1-23: as S8, then B's fold lands on the recovery and the NEXT write is lost; a second restart replays"
delay 25
arm_store "marker=agentWait%26%26call_${T}s9_b" > /dev/null
P=$(newp "PARENT::fgfg::${T}s9::reply two foreground children, replay after B's fold."); echo "   parent $P"
for i in $(seq 240); do [ "$(heldsid $P)" -ge 1 ] && break; sleep 0.5; done; lastheld
arm_store "after=functionResponse%26%26call_${T}s9_b" > /dev/null
restart
for i in $(seq 400); do [ "$(heldsid $P)" -ge 2 ] && break; sleep 0.5; done; lastheld
echo "   before the second restart:"; ledger $P; results $P
restart; delay 0
echo "   interrupted turn: $(waitterm $P 180)"; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT|model text"; modelsaw "${T}s9" 300
next $P ${T}s9c
echo "== $(date -u +%T) probe5 DONE"
