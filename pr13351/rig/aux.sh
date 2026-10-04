#!/bin/bash
# VERIFICATION RIG ONLY: fake model, Spring->Harness tap, browser-side wire for one arm.  usage: aux.sh <arm>
. /Users/wenshao/pr13351-rig/rig.env; . $RIG/ports.sh $1; ARM=$1
RUN=$RIG/run/$ARM; mkdir -p $RUN
[ -f $RUN/tap-rules.json ] || echo '[]' > $RUN/tap-rules.json
[ -f $RUN/wire-rules.json ] || echo '[]' > $RUN/wire-rules.json
nohup $NODE $RIG/probe/model.mjs $MODEL_PORT $RUN/model-requests.jsonl > $RUN/model.log 2>&1 & echo $! > $RUN/model.pid
nohup $NODE $RIG/probe/tap.mjs $TAP_PORT $HARNESS_PORT $RUN/tap.jsonl $RUN/tap-rules.json > $RUN/tap.log 2>&1 & echo $! > $RUN/tap.pid
nohup $NODE $RIG/probe/wire.mjs $WIRE_PORT $SPRING_PORT $RUN/wire.jsonl $RUN/wire-rules.json > $RUN/wire.log 2>&1 & echo $! > $RUN/wire.pid
sleep 1; cat $RUN/model.log $RUN/tap.log $RUN/wire.log
