#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): fake model + recording tap inside the container.  usage: aux.sh <db>
. /Users/wenshao/pr13673-rig/lx/env.sh
DB=$1; RUN=$VAR/run/$DB; LOGD=$RIG/run/$DB; mkdir -p $RUN $LOGD
[ -f $LOGD/tap-rules.json ] || echo '[]' > $LOGD/tap-rules.json
nohup $NODE $RIG/probe/model.mjs $MODEL_PORT $LOGD/model-requests.jsonl > $LOGD/model.log 2>&1 & echo $! > $RUN/model.pid
nohup $NODE $RIG/probe/tap.mjs $TAP_PORT $HARNESS_PORT $LOGD/tap.jsonl $LOGD/tap-rules.json > $LOGD/tap.log 2>&1 & echo $! > $RUN/tap.pid
sleep 1; cat $LOGD/model.log $LOGD/tap.log
[ -f $LOGD/store-tap-rules.json ] || echo '[]' > $LOGD/store-tap-rules.json
nohup $NODE $RIG/probe/tap.mjs $STORE_TAP_PORT $SPRING_PORT $LOGD/store-tap.jsonl $LOGD/store-tap-rules.json > $LOGD/store-tap.log 2>&1 & echo $! > $RUN/storetap.pid
sleep 0.5; cat $LOGD/store-tap.log
[ -f $LOGD/broker-tap-rules.json ] || echo '[]' > $LOGD/broker-tap-rules.json
nohup $NODE $RIG/probe/tap.mjs $BROKER_TAP_PORT $BROKER_PORT $LOGD/broker-tap.jsonl $LOGD/broker-tap-rules.json > $LOGD/broker-tap.log 2>&1 & echo $! > $RUN/brokertap.pid
sleep 0.5; cat $LOGD/broker-tap.log
