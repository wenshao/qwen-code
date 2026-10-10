#!/bin/bash
# usage: probe3.sh <db> <tag> — interruption point 2 (re-run with the fixed hold detection)
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null
echo "== S3 interruption point 2: child answer accepted, the parent's tool_result commit lost with the Harness"
arm_store "marker=CHILD_RESULT::${T}s3::ok%26%26functionResponse" > /dev/null
P=$(newp "PARENT::fg::${T}s3::reply point-2 tool result lost."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $SCTL ${T}s3)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; e=[x for x in h if '${T}s3' in x['marker']]; print('   HELD', e[-1]['at'], e[-1]['path'][-50:], '|', e[-1]['snippet'][180:520].replace(chr(10),' ')) if e else print('   NOT HELD')"
echo "   before restart:"; ledger $P; results $P
restart
echo "   interrupted turn: $(waitterm $P 120)"; turns $P; ledger $P; results $P; msgs $P 160; modelsaw "${T}s3"
next $P ${T}s3b
echo "== $(date -u +%T) probe3 DONE"
