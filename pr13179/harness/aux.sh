#!/bin/bash
# VERIFICATION RIG ONLY: fake model, Spring->Harness tap, and one browser-side wire per Web Shell arm.  usage: aux.sh <db>
. /Users/wenshao/pr13179-rig/rig.env
DB=$1; RUN=$RIG/run/$DB; mkdir -p $RUN
[ -f $RUN/tap-rules.json ] || echo '[]' > $RUN/tap-rules.json
for a in head base; do [ -f $RUN/wire-$a-rules.json ] || echo '[]' > $RUN/wire-$a-rules.json; done
nohup $NODE $RIG/probe/model.mjs $MODEL_PORT $RUN/model-requests.jsonl > $RUN/model.log 2>&1 & echo $! > $RUN/model.pid
nohup $NODE $RIG/probe/tap.mjs $TAP_PORT $HARNESS_PORT $RUN/tap.jsonl $RUN/tap-rules.json > $RUN/tap.log 2>&1 & echo $! > $RUN/tap.pid
nohup $NODE $RIG/probe/wire.mjs $WIRE_HEAD_PORT $SPRING_PORT $RUN/wire-head.jsonl $RUN/wire-head-rules.json > $RUN/wire-head.log 2>&1 & echo $! > $RUN/wire-head.pid
nohup $NODE $RIG/probe/wire.mjs $WIRE_BASE_PORT $SPRING_PORT $RUN/wire-base.jsonl $RUN/wire-base-rules.json > $RUN/wire-base.log 2>&1 & echo $! > $RUN/wire-base.pid
sleep 1; cat $RUN/model.log $RUN/tap.log $RUN/wire-head.log $RUN/wire-base.log
