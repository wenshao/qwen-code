#!/bin/bash
DB=L18; . /rig/llib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$1' AND status='RUNNING'"; }
crunning() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
lastturn() { sq "SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='$1' ORDER BY created_at DESC LIMIT 1"; }
waitterm() { for i in $(seq ${2:-90}); do s=$(lastturn $1); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done; echo "$s"; }
restart() { echo "   $(date -u +%T) restart harness (workers before: $(W))"; node lstack.mjs harness $DB 2>&1 | tail -1; sleep 15; echo "   $(date -u +%T) harness back (workers: $(W))"; }
echo "== L1 control: parent model call in flight across a harness restart"
P=$(newp "PARENT::phold::mph1::x parent model call held."); for i in $(seq 30); do [ "$(running $P)" = 1 ] && break; sleep 1; done; echo "   turn running after ${i}s"
restart; curl -s http://127.0.0.1:18551/release/mph1 >/dev/null
echo "   interrupted turn: $(waitterm $P)"
node lclient.mjs $DB send $P "PARENT::plain::mph1b::x next turn." > /dev/null; sleep 2; echo "   next turn: $(waitterm $P)"
echo "== L2: parent waiting on a foreground child across a harness restart"
P=$(newp "PARENT::fg::mrf1::hold foreground child held."); for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done; echo "   child running after ${i}s"
restart; curl -s http://127.0.0.1:18551/release/mrf1 >/dev/null
echo "   interrupted parent turn: $(waitterm $P)"; turns $P
node lclient.mjs $DB send $P "PARENT::plain::mrf1b::x next turn." > /dev/null; sleep 2; echo "   next turn: $(waitterm $P)"; ledger $P; kids $P
echo "== L3: background child across a harness restart"
P=$(newp "PARENT::bg::mrb1::hold background child held."); waitT $P 60 | tail -1; for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done; echo "   child running after ${i}s"
restart; curl -s http://127.0.0.1:18551/release/mrb1 >/dev/null
sleep 60; turns $P; ledger $P; kids $P; grep -c "mrb1" runs/model-requests.jsonl
node lclient.mjs $DB send $P "PARENT::plain::mrb1b::x next turn." > /dev/null; sleep 2; echo "   next turn: $(waitterm $P)"
echo "== $(date -u +%T) Lrestart DONE workers=$(W)"
