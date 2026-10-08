#!/bin/bash
# Round 5, l5: a LIVE wake tool wait spanning a slot. L4 (overlap skip, every minute) asks for read_file;
# the gateway holds its first model request 50 s (HOLD1), then the Broker tap holds the execution poll
# 25 s (below the Harness's ~30 s Broker request timeout), so the read_file wait spans the next :00 slot,
# where the scanner calls reconcile_run against a run that is alive. Created after :05 so the first fire
# is the next minute.
cd /Users/wenshao/git/pr13598-rig
source mk4.sh
L=runs/l5/actions.log
until [ "$(date -u +%S)" -ge 5 ] && [ "$(date -u +%S)" -le 40 ]; do sleep 1; done
node client.mjs l5 acreate "$(mk $(cat runs/l5/L1 | head -0; cat runs/l5/L3) 'live tool wait across a slot' "AUTO::l4 HOLD1::l4hold::50 $TOOLP" skip '* * * * *')" key-L4 | tee runs/l5/l4-create.json | short
node -e "console.log(JSON.parse(require('fs').readFileSync('runs/l5/l4-create.json')).json.id)" > runs/l5/l4.id
curl -s -XPOST localhost:36216/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":25000,"count":1}'; echo
echo "$(date -u +%T) L4 created on Session L3 (skip): first model request held 50 s, then the execution poll held 25 s" >> $L
