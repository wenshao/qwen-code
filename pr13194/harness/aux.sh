#!/bin/bash
# VERIFICATION RIG ONLY: fake model + tap inside the container.  usage: aux.sh <db>
. /Users/wenshao/pr13135-rig/lx/env.sh
DB=$1; RUN=$VAR/run/$DB; LOGD=$RIG/run/lx-$DB; mkdir -p $RUN $LOGD
[ -f $LOGD/tap-rules.json ] || echo '[]' > $LOGD/tap-rules.json
nohup $NODE $RIG/probe/model.mjs $MODEL_PORT $LOGD/model-requests.jsonl > $LOGD/model.log 2>&1 & echo $! > $RUN/model.pid
nohup $NODE $RIG/probe/tap.mjs $TAP_PORT $HARNESS_PORT $LOGD/tap.jsonl $LOGD/tap-rules.json > $LOGD/tap.log 2>&1 & echo $! > $RUN/tap.pid
sleep 1; cat $LOGD/model.log $LOGD/tap.log
