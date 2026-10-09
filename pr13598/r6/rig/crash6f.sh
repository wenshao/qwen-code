#!/bin/bash
# f6: wait for a NEW delayed execution poll, SIGKILL the Harness 8 s later, make the Broker tap refuse
# every GET executions/<id> (503) for the next 600 reads, then start the Harness again. The fault is
# cleared by hand later (DELETE /rule on the tap control port).
cd /Users/wenshao/git/pr13598-rig; DB=f6; L=runs/$DB/actions.log; T=runs/$DB/broker-tap.jsonl; CTL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("runs/f6/state.json")).brokerTapPort+1)')
n0=$(grep -c '"rule":"delay"' $T 2>/dev/null || true); n0=${n0:-0}
until [ "$(grep -c '"rule":"delay"' $T 2>/dev/null || echo 0)" -gt "$n0" ]; do sleep 0.5; done
echo "$(date -u +%T) delayed tool poll seen (F1 mid tool)" >> $L
sleep 8
echo "$(date -u +%T) kill Harness (F1 mid tool)" >> $L
node stack.mjs stop $DB harness >> $L 2>&1
echo "$(date -u +%T) tap: refuse every GET executions/<id> (503), up to 600" >> $L
curl -s -XPOST localhost:$CTL/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"refuse","count":600}' >> $L; echo >> $L
node stack.mjs harness $DB >> $L 2>&1
echo "$(date -u +%T) restarted (fault still on)" >> $L
