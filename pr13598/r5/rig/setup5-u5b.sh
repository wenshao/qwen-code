#!/bin/bash
# Round 5, u5 clean repros of "the user Turn that loads a crashed Session": one manual read_file run per
# Session, crashed alone inside the tool call (tap delay count 1), then a user Turn N s after the restart.
#   U5: N=10   U6: N=20
cd /Users/wenshao/git/pr13598-rig
source mk4.sh
U=runs/u5/actions.log
one() {
  local n=$1 wait=$2 lc
  lc=$(echo "$n" | tr 'A-Z' 'a-z')
  mks u5 $n 2>/dev/null; sleep 12
  node client.mjs u5 acreate "$(mk $(cat runs/u5/$n) "manual tool run $n" "MANUAL::$lc $TOOLP" skip '0 0 1 1 *')" key-$n | tee runs/u5/$lc-create.json | short
  node -e "console.log(JSON.parse(require('fs').readFileSync('runs/u5/$lc-create.json')).json.id)" > runs/u5/$lc.id
  curl -s -XPOST localhost:36206/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}'; echo
  local before
  before=$(grep -c "restarted" $U)
  nohup ./crash5.sh u5 "$n manual run mid tool" >/dev/null 2>&1 &
  sleep 1
  node client.mjs u5 arun $(cat runs/u5/$lc.id) key-$lc-run | short
  echo "$(date -u +%T) manual run of $n" >> $U
  until [ "$(grep -c "restarted" $U)" -gt "$before" ]; do sleep 0.5; done
  sleep $wait
  echo "$(date -u +%T) $n user Turn, $wait s after the restart" >> $U
  node client.mjs u5 send $(cat runs/u5/$n) "USER::$lc-user Reply with exactly: PONG" | grep -E '"turn_id"' | head -1 >> $U
}
one U5 10
sleep 100
one U6 20
echo "$(date -u +%T) u5b done" >> $U
