#!/bin/bash
# f4: wait for the delayed execution poll, SIGKILL the Harness 8 s later, make the Broker tap refuse the
# next 4 execution status reads (503), then start the Harness again — the recovery's stop step fails.
cd /Users/wenshao/git/pr13598-rig; DB=f4; L=runs/$DB/actions.log
until grep -q '"rule":"delay"' runs/$DB/broker-tap.jsonl 2>/dev/null; do sleep 0.5; done
echo "$(date -u +%T) delayed tool poll seen (F1 mid tool)" >> $L
sleep 8
echo "$(date -u +%T) kill Harness (F1 mid tool)" >> $L
node stack.mjs stop $DB harness >> $L 2>&1
echo "$(date -u +%T) tap: refuse next 4 GET executions/<id> (503)" >> $L
curl -s -XPOST localhost:36126/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"refuse","count":4}' >> $L; echo >> $L
node stack.mjs harness $DB >> $L 2>&1
echo "$(date -u +%T) restarted" >> $L
