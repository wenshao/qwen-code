#!/bin/bash
# usage: crash4.sh <db> <label>  — wait for the delayed execution poll, then SIGKILL+restart the Harness 8 s later
cd /Users/wenshao/git/pr13598-rig; DB=$1; L=runs/$DB/actions.log
until grep -q '"rule":"delay"' runs/$DB/broker-tap.jsonl 2>/dev/null; do sleep 0.5; done
echo "$(date -u +%T) delayed tool poll seen ($2)" >> $L
sleep 8
echo "$(date -u +%T) kill+restart Harness ($2)" >> $L
node stack.mjs harness $DB >> $L 2>&1
echo "$(date -u +%T) restarted" >> $L
