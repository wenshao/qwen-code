#!/bin/bash
# usage: probe8b.sh <db> <tag> <parentSessionId> — n4 follow-up: state after the faulted takeover, then a second (clean) restart
DB=$1; T=$2; P=$3; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
echo "== n4b $(date -u +%T) state after the faulted takeover (fault fully spent: $(curl -s http://127.0.0.1:$SCTL/faults | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["faults"]))') x 503)"
turns $P; results $P; ckpts $P 4; modelsaw "${T}n4" 160
hlog "prior activation\|did not adopt\|recovery blocked\|failed:" 4
echo "== n4b second restart, no fault armed"
restart
echo "   interrupted turn: $(waitterm $P 180)"; turns $P; ledger $P; results $P; msgs $P 200 | grep -E "CALL|RESULT|model text"; modelsaw "${T}n4" 200; ckpts $P 8
find runs/$DB -name "parent-${T}n4.txt" | sed 's/^/   file    /'
hlog "prior activation\|did not adopt\|recovery blocked\|failed:\|no journaled" 6
next $P ${T}n4c
echo "== $(date -u +%T) probe8b DONE"
