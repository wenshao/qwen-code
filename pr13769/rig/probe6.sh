#!/bin/bash
# usage: probe6.sh <db> <tag> — S6 crash window, then: who holds the Workspace lease, and can a NEW session run a shell round?
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
lease() { sq "SELECT IFNULL(runtime_session_id,'-'), IFNULL(csi_phase,'-') FROM managed_workspace_execution_lease" | sed 's/^/   lease   /'; }
echo "== L-1 lease before anything:"; lease
echo "== S6 (R1-1 window) live fold, then a crash in the shell round (Broker prepare held)"
arm_broker "path=executions:prepare" > /dev/null
P=$(newp "PARENT::fgsh::${T}s6::reply live fold then a shell round lost mid-prepare."); echo "   parent $P"
for i in $(seq 120); do [ "$(heldn $BCTL executions:prepare)" -ge 1 ] && break; sleep 0.5; done
held_broker | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], h[-1]['path']) if h else print('   NOT HELD')"
restart
echo "   interrupted turn: $(waitterm $P 150)"; results $P; find runs/$DB -name "parent-${T}s6.txt" | sed 's/^/   file    /'; next_t=$(node client.mjs $DB send $P "PARENT::plain::${T}s6b::x" >/dev/null; sleep 2; waitterm $P 90); echo "   next turn (plain): $next_t"
echo "   lease after S6:"; lease
echo "== X1 a NEW session runs one plain shell round"
X=$(newp "PARENT::sh::${T}x1::x new session after the crash."); echo "   session $X"; echo "   turn after 120 s budget: $(waitterm $X 60)"; find runs/$DB -name "parent-${T}x1.txt" | sed 's/^/   file    /'
echo "   broker acquires since: $(grep -c 'tool-sessions:acquire.*409' runs/$DB/bproxy.jsonl) x 409"
echo "== $(date -u +%T) probe6 DONE"
