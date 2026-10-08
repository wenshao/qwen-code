#!/bin/bash
DB=r3m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
run() { L=$1; W=$2; shift 2; ./sc.sh $DB $L $W "$@"; }
for x in "b1:fill20480c60:20 KiB of less-than" "b2:fill16290c60:16290 less-than" "b3:lines:multi-line answer" "b4:mix20000c92x20000c60:backslashes then less-than"; do
  IFS=: read L SPEC DESC <<< "$x"
  run $L 120 "PARENT::bg::$L::$SPEC background child, $DESC." | tail -1; S=$(cat runs/$DB/$L.sid); consumed_wait $S 90; sleep 3; ledger $S; notif $S
done
echo "-- b2 follow-up Turn on the same parent (round-2 B1b wedged it)"
S=$(cat runs/$DB/b2.sid); node client.mjs $DB send $S "PARENT::plain::b2f::x follow-up after the large notification." | cut -c1-120
for i in $(seq 60); do n=$(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$S'"); c=$(sq "SELECT status, IFNULL(error_code,'-') FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at DESC LIMIT 1"); [[ "$c" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && [ "$n" -ge 3 ] && break; sleep 1; done
sq "SELECT turn_id, status, IFNULL(error_code,'-') FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at"; modelsaw b2f 200
for x in "c1:fg:fill20480c60:foreground child, 20 KiB of less-than" "c2:fg:mid:foreground child, 100 KiB answer" "c3:bigp:reply:foreground child with a 40 KiB prompt" "c4:subagent:reply:child with subagent_type" "c5:five:reply:five background children in one batch"; do
  IFS=: read L MODE SPEC DESC <<< "$x"
  run $L 180 "PARENT::$MODE::$L::$SPEC $DESC." | grep -o 'saw=[^"]*\|TERMINAL.*\|TIMEOUT' | cut -c1-330; sleep 3; S=$(cat runs/$DB/$L.sid); ledger $S
  sq "SELECT COUNT(*) FROM managed_agent_session WHERE parent_session_id='$S'" | sed 's/^/   child sessions: /'
done
sleep 20; echo "-- c5 after 20s"; ledger $(cat runs/$DB/c5.sid)
echo "-- d1: Turn 1 runs a shell tool, Turn 2 (fresh) launches a foreground child that runs a shell tool"
run d1 120 "PARENT::sh::d1::reply shell only." | tail -1; S=$(cat runs/$DB/d1.sid)
node client.mjs $DB send $S "PARENT::fg::d1b::shell now a foreground child in a fresh turn." | cut -c1-100
for i in $(seq 180); do c=$(sq "SELECT status FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at DESC LIMIT 1"); n=$(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$S'"); [ "$n" -ge 2 ] && [[ "$c" =~ ^(COMPLETED|FAILED|CANCELLED)$ ]] && break; sleep 1; done; echo "   turn2 $c after ${i}s"
sq "SELECT turn_id, status, IFNULL(error_code,'-'), FROM_UNIXTIME(created_at/1000,'%H:%i:%s'), FROM_UNIXTIME(completed_at/1000,'%H:%i:%s') FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at"; modelsaw d1b 250; ledger $S
echo "== $(date -u +%T) batch2 DONE"
