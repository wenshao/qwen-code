#!/bin/bash
# Round 5:
#  l5 — live runs that must survive reconcile_run (no crash): L1 skip text HOLD::80 every minute (each run
#       spans the next slot); L2 skip read_file every minute whose first execution poll the tap holds 100 s
#       (a live tool wait spanning a slot). A user Turn on L2 and a read_file Turn on L3 are sent mid-wait.
#  u5 — two far-cron read_file definitions run manually and crashed together inside the tool call; a user
#       Turn loads U3 10 s after the restart (old writer lease still held) and U4 75 s after it.
cd /Users/wenshao/git/pr13598-rig
source mk4.sh
mkdef() {
  local db=$1 n=$2 goal=$3 prompt=$4 ov=$5 cron=$6
  local D=runs/$db lc
  lc=$(echo "$n" | tr 'A-Z' 'a-z')
  node client.mjs $db acreate "$(mk $(cat $D/$n) "$goal" "$prompt" $ov "$cron")" key-$n | tee $D/$lc-create.json | short
  node -e "console.log(JSON.parse(require('fs').readFileSync('$D/$lc-create.json')).json.id)" > $D/$lc.id
}
L=runs/l5/actions.log
mkdef l5 L1 "live long text skip" "AUTO::l1 HOLD::80 Reply with exactly: TICK" skip '* * * * *'
mkdef l5 L2 "live slow tool skip" "AUTO::l2 $TOOLP" skip '* * * * *'
curl -s -XPOST localhost:36216/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":100000,"count":1}'; echo
echo "$(date -u +%T) l5 definitions created; tap holds the first execution poll 100 s (live, no crash)" >> $L

U=runs/u5/actions.log
mkdef u5 U3 "manual tool run U3" "MANUAL::u3 $TOOLP" skip '0 0 1 1 *'
mkdef u5 U4 "manual tool run U4" "MANUAL::u4 $TOOLP" skip '0 0 1 1 *'
curl -s -XPOST localhost:36206/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":2}'; echo
nohup ./crash5.sh u5 "U3 and U4 manual runs mid tool" >/dev/null 2>&1 &
sleep 1
for n in U3 U4; do
  lc=$(echo "$n" | tr 'A-Z' 'a-z')
  node client.mjs u5 arun $(cat runs/u5/$lc.id) key-$lc-run | short
  echo "$(date -u +%T) manual run of $n" >> $U
done
until grep -q "restarted" $U; do sleep 0.5; done
sleep 10
echo "$(date -u +%T) U3 user Turn, 10 s after the restart" >> $U
node client.mjs u5 send $(cat runs/u5/U3) "USER::u3-early Reply with exactly: PONG" | grep -E '"turn_id"' | head -1 >> $U
sleep 65
echo "$(date -u +%T) U4 user Turn, 75 s after the restart" >> $U
node client.mjs u5 send $(cat runs/u5/U4) "USER::u4-late Reply with exactly: PONG" | grep -E '"turn_id"' | head -1 >> $U
echo "$(date -u +%T) u5 sends done" >> $U
