#!/bin/bash
DB=${DB:-r3m}; . /Users/wenshao/git/pr13550-rig/r3lib.sh
echo "-- e1: four background children whose model call fails, then a fresh launch on the same parent"
./sc.sh $DB e1 120 "PARENT::five::e1::error five background children that fail." | grep -o 'saw=[^"]*\|TERMINAL.*' | cut -c1-200
S=$(cat runs/$DB/e1.sid); sleep 40; node client.mjs $DB dump $S | sed -n '/turns/,$p' | cut -c1-200
node client.mjs $DB send $S "PARENT::bg::e1b::reply one more background child after the failures." | cut -c1-80
for i in $(seq 60); do c=$(sq "SELECT status FROM managed_agent_turn WHERE session_id='$S' ORDER BY created_at DESC LIMIT 1"); n=$(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$S'"); [ "$n" -ge 2 ] && [[ "$c" =~ ^(COMPLETED|FAILED)$ ]] && break; sleep 1; done
modelsaw e1b 300
echo "== $(date -u +%T) batch3 DONE"
