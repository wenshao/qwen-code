#!/bin/bash
DB=r10n; . /Users/wenshao/git/pr13550-rig/r3lib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$1' AND status='RUNNING'"; }
crunning() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
lastturn() { sq "SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='$1' ORDER BY created_at DESC LIMIT 1"; }
waitterm() { for i in $(seq ${2:-90}); do s=$(lastturn $1); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done; echo "$s"; }
restart() { echo "   $(date -u +%T) restart harness"; node stack.mjs harness $DB 2>&1 | tail -1; sleep 15; echo "   $(date -u +%T) harness back"; }
newp() { node client.mjs $DB create "$1" > /dev/null; sleep 2; sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id IS NULL ORDER BY created_at DESC LIMIT 1"; }
echo "== control: the parent's own model call in flight across a harness restart (no child)"
P=$(newp "PARENT::phold::r10ph1::x parent model call held."); for i in $(seq 30); do [ "$(running $P)" = 1 ] && break; sleep 1; done; echo "   turn running after ${i}s"
restart; curl -s http://127.0.0.1:18551/release/r10ph1 >/dev/null
echo "   interrupted turn: $(waitterm $P)"
node client.mjs $DB send $P "PARENT::plain::r10ph1b::x a new turn on the same session." > /dev/null; sleep 2; echo "   next turn: $(waitterm $P)"
echo "== repeat: parent waiting on a foreground child across a harness restart"
P=$(newp "PARENT::fg::r10rf2::hold foreground child held while the harness restarts."); for i in $(seq 30); do [ "$(crunning $P)" = 1 ] && break; sleep 1; done; echo "   child running after ${i}s"
restart; curl -s http://127.0.0.1:18551/release/r10rf2 >/dev/null
echo "   interrupted parent turn: $(waitterm $P)"
node client.mjs $DB send $P "PARENT::plain::r10rf2b::x a new turn on the same session." > /dev/null; sleep 2; echo "   next turn: $(waitterm $P)"
ledger $P
echo "== $(date -u +%T) control DONE"
