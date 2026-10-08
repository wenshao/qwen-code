#!/bin/bash
cd /Users/wenshao/git/pr13598-rig; L=runs/z3/actions.log
until grep -q '"rule":"delay"' runs/z3/broker-tap.jsonl 2>/dev/null; do sleep 0.5; done
echo "$(date -u +%T) delayed tool poll seen (Z1 mid tool)" >> $L
sleep 8
echo "$(date -u +%T) kill+restart Harness (Z1 mid tool, Z2 mid HOLD)" >> $L
node stack.mjs harness z3 >> $L 2>&1
echo "$(date -u +%T) restarted" >> $L
