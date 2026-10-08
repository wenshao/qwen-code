#!/bin/bash
DB=r11m; . /Users/wenshao/git/pr13550-rig/r3lib.sh
lastturn() { sq "SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='$1' ORDER BY created_at DESC LIMIT 1"; }
waitterm() { for i in $(seq ${2:-60}); do s=$(lastturn $1); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done; echo "$s"; }
for m in dups dupb; do
  echo "== $m: two agent calls in one Turn reuse callId call_0"
  ./sc.sh $DB $m 120 "PARENT::$m::r11$m::reply reuse one callId for two agent calls." | grep -o 'saw=[^"]*\|TERMINAL.*\|TIMEOUT' | cut -c1-200
  S=$(cat runs/$DB/$m.sid); sleep 8; echo "   turn: $(lastturn $S)"; ledger $S
  python3 msgs.py $DB $S | grep -E "CALL|RESULT" | cut -c16-260
  sq "SELECT COUNT(*) FROM managed_agent_session WHERE parent_session_id='$S'" | sed 's/^/   child sessions: /'
  node client.mjs $DB send $S "PARENT::plain::r11${m}n::x next turn on the same session." > /dev/null; sleep 2; echo "   next turn: $(waitterm $S)"
done
echo "== $(date -u +%T) f5 DONE"
