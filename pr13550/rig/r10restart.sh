#!/bin/bash
# Harness restart while (a) a parent waits on a foreground child, (b) a background child runs.
DB=r10m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
running() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
turns() { sq "SELECT IF(s.parent_session_id IS NULL,'parent','child '), t.status, IFNULL(t.error_code,'-'), FROM_UNIXTIME(t.created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(t.completed_at/1000,'%H:%i:%s'),'-') FROM managed_agent_turn t JOIN managed_agent_session s ON s.tenant_id=t.tenant_id AND s.session_id=t.session_id WHERE s.session_id='$1' OR s.parent_session_id='$1' ORDER BY t.created_at"; }
restart() { echo "   $(date -u +%T) restart harness"; node stack.mjs stop $DB harness 2>&1 | tail -1; sleep 3; node stack.mjs harness $DB 2>&1 | tail -1; for i in $(seq 60); do curl -s -o /dev/null --noproxy '*' http://127.0.0.1:$(python3 -c "import json;print(json.load(open('runs/$DB/state.json'))['harnessPort'])")/health 2>/dev/null && break; sleep 1; done; sleep 5; echo "   $(date -u +%T) harness back"; }
echo "== (a) foreground wait across a harness restart"
node client.mjs $DB create "PARENT::fg::r10rf1::hold foreground child held while the harness restarts." > /dev/null; sleep 2
P=$(sq "SELECT session_id FROM managed_agent_session WHERE parent_session_id IS NULL ORDER BY created_at DESC LIMIT 1"); echo $P > runs/$DB/rf1.sid
for i in $(seq 60); do [ "$(running $P)" = 1 ] && break; sleep 1; done; echo "   child turn running after ${i}s"; turns $P
restart
echo "   $(date -u +%T) release the child"; curl -s http://127.0.0.1:18551/release/r10rf1 >/dev/null
for i in $(seq 120); do s=$(sq "SELECT status FROM managed_agent_turn WHERE session_id='$P' ORDER BY created_at LIMIT 1"); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED)$ ]] && break; sleep 2; done
echo "   $(date -u +%T) parent turn: $s"; turns $P; ledger $P
node client.mjs $DB events $P | tail -4 | cut -c1-260
echo "== (b) background child across a harness restart"
./sc.sh $DB rb1 60 "PARENT::bg::r10rb1::hold background child held while the harness restarts." | tail -1; P=$(cat runs/$DB/rb1.sid)
for i in $(seq 60); do [ "$(running $P)" = 1 ] && break; sleep 1; done; echo "   child turn running after ${i}s"
restart
echo "   $(date -u +%T) release the child"; curl -s http://127.0.0.1:18551/release/r10rb1 >/dev/null
consumed_wait $P 150; sleep 5; turns $P; ledger $P; modelsaw r10rb1 160
echo "== $(date -u +%T) restart probes DONE"
