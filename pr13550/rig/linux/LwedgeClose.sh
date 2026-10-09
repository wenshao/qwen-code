#!/bin/bash
# Can an operator close a parent that a Harness restart wedged mid-delegation?
DB=L18; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$1' AND status='RUNNING'"; }
crunning() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
lastturn() { sq "SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='$1' ORDER BY created_at DESC LIMIT 1"; }
waitterm() { for i in $(seq ${2:-90}); do s=$(lastturn $1); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done; echo "$s"; }
restart() { echo "   $(date -u +%T) restart harness"; node lstack.mjs harness $DB 2>&1 | tail -1; sleep 15; }
closeit() { echo "   $(date -u +%T) close:"; node lclient.mjs $DB close $1 | cut -c1-140; untilst "parent" "st $1" 240 CLOSED; ops $1; ledger $1; kids $1; turns $1; }
echo "== W1: wedged by a restart during a foreground delegation, then closed"
P=$(newp "PARENT::fg::lw1::hold foreground child held."); for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done
restart; curl -s http://127.0.0.1:18551/release/lw1 >/dev/null
echo "   parent turn: $(waitterm $P)"; node lclient.mjs $DB send $P "PARENT::plain::lw1b::x" > /dev/null; sleep 2; echo "   next turn: $(waitterm $P)"; ledger $P
closeit $P
node lclient.mjs $DB delete $P | cut -c1-120; untilst "parent" "st $P" 60 DELETED
grep "$P" /work/$DB/spring.log | grep -o "failure=.*" | sort | uniq -c | sort -rn | head -4 | cut -c1-200
echo "== W2 control: wedged with no child (parent model call held), then closed"
P=$(newp "PARENT::phold::lw2::x parent model call held."); for i in $(seq 30); do [ "$(running $P)" = 1 ] && break; sleep 1; done
restart; curl -s http://127.0.0.1:18551/release/lw2 >/dev/null
echo "   parent turn: $(waitterm $P)"
closeit $P
grep "$P" /work/$DB/spring.log | grep -o "failure=.*" | sort | uniq -c | sort -rn | head -4 | cut -c1-200
echo "== $(date -u +%T) wedgeClose DONE workers=$(W)"
