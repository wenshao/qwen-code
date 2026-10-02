#!/bin/bash
# VERIFICATION RIG ONLY (PR #13225): fake model + tap + fake OSS in the container.  usage: aux.sh <db>
. /Users/wenshao/pr13225-rig/lx/env.sh
DB=$1; RUN=$VAR/run/$DB; LOGD=$RIG/run/lx-$DB; mkdir -p $RUN $LOGD $RIG/run/oss-data
nohup $NODE $RIG/probe/model.mjs $MODEL_PORT $LOGD/model-requests.jsonl > $LOGD/model.log 2>&1 & echo $! > $RUN/model.pid
nohup $NODE $RIG/probe/tap.mjs $TAP_PORT $HARNESS_PORT $LOGD/tap.jsonl > $LOGD/tap.log 2>&1 & echo $! > $RUN/tap.pid
pgrep -f "probe/fake-oss.mjs" >/dev/null || { OSS_DATA=$RIG/run/oss-data DATA_PORT=$OSS_PORT ADMIN_PORT=$OSS_ADMIN nohup $NODE $RIG/probe/fake-oss.mjs > $RIG/run/fake-oss.log 2>&1 & echo $! > $VAR/fake-oss.pid; }
sleep 1; cat $LOGD/model.log $LOGD/tap.log $RIG/run/fake-oss.log
