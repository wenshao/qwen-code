#!/bin/bash
# VERIFICATION RIG ONLY: start the fake model and the tap.  usage: aux.sh <db>
. /Users/wenshao/pr13135-rig/rig.env
DB=$1; RUN=$RIG/run/$DB; mkdir -p $RUN
[ -f $RUN/tap-rules.json ] || echo '[]' > $RUN/tap-rules.json
nohup $NODE $RIG/probe/model.mjs $MODEL_PORT $RUN/model-requests.jsonl > $RUN/model.log 2>&1 & echo $! > $RUN/model.pid
nohup $NODE $RIG/probe/tap.mjs $TAP_PORT $HARNESS_PORT $RUN/tap.jsonl $RUN/tap-rules.json > $RUN/tap.log 2>&1 & echo $! > $RUN/tap.pid
sleep 1; cat $RUN/model.log $RUN/tap.log
