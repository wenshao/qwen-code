#!/bin/bash
# usage: probe10.sh <db> <tag> — round 3 (01759f90): the shared inline-fit helper's truncation branch, live arm (T1) and gap fill (T2)
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
heldsid() { curl -s "http://127.0.0.1:$SCTL/held" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin)['held'] if '$1' in x['path']))"; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null
echo "== T1 live arm: a foreground child returns 65,480 chars (under the child-result limit, over the inline bound once wrapped)"
P=$(newp "PARENT::fg::${T}t1::fill65480c120 big child result folded by the live arm."); echo "   parent $P"
echo "   turn: $(waitterm $P 120)"; turns $P; python3 rlen.py $DB $P; modelsaw "${T}t1" 140
next $P ${T}t1c
echo "== T2 gap fill: [fg A, fg B(65,480 chars)]; B admitted, B's wait commit lost; child creation held 45 s so B's child runs only after the restart"
delay 45
arm_store "marker=agentWait%26%26call_${T}t2_b" > /dev/null
P=$(newp "PARENT::fgfg::${T}t2::fill65480c120 B's big answer folded by the recovery gap fill."); echo "   parent $P"
for i in $(seq 360); do [ "$(heldsid $P)" -ge 1 ] && break; sleep 0.5; done; echo "   $(date -u +%T) B's wait commit held"; ledger $P; results $P
restart
echo "   interrupted turn: $(waitterm $P 240)"; delay 0; turns $P; ledger $P; python3 rlen.py $DB $P; modelsaw "${T}t2" 140
grep -c "parent-after-tool.*${T}t2" runs/model-requests.jsonl | sed 's/^/   parent final model calls: /'
next $P ${T}t2c
echo "== $(date -u +%T) probe10 DONE"
