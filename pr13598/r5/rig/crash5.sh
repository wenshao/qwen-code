#!/bin/bash
# usage: crash5.sh <db> <label>  — wait for a NEW delayed execution poll (after this script started), then SIGKILL+restart the Harness 8 s later
cd /Users/wenshao/git/pr13598-rig; DB=$1; L=runs/$DB/actions.log; T=runs/$DB/broker-tap.jsonl
n0=$(grep -c '"rule":"delay"' $T 2>/dev/null || true); n0=${n0:-0}
until [ "$(grep -c '"rule":"delay"' $T 2>/dev/null || echo 0)" -gt "$n0" ]; do sleep 0.5; done
echo "$(date -u +%T) delayed tool poll seen ($2)" >> $L
sleep 8
echo "$(date -u +%T) kill+restart Harness ($2)" >> $L
node stack.mjs harness $DB >> $L 2>&1
echo "$(date -u +%T) restarted" >> $L
