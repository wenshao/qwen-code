#!/bin/bash
# usage: RUNNAME=x [DRIVER=drive-r7.cjs] run-case.sh <arm> <basePort> <engine> <pageHost> [driver flags...] -- [serve flags...]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/aca33818-ac1e-4286-aafe-a4b2ded6adec/scratchpad; H=$S/r7/harness
ARM=$1; P=$2; ENGINE=$3; HOST=$4; shift 4
DRV=(); while [ $# -gt 0 ] && [ "$1" != "--" ]; do DRV+=("$1"); shift; done; [ "$1" = "--" ] && shift
DP=$P; FP=$((P+1)); VP=$((P+2)); EP=$((P+3))
export RUNNAME=${RUNNAME:-$ARM-$ENGINE}; RUN=$S/r7/run-$RUNNAME
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; export NO_PROXY='*' no_proxy='*'
$H/start-arm.sh $ARM $DP $FP $VP $EP "$@" &
sleep 1
node $H/fake-openai.mjs $FP $RUN/openai.jsonl > $RUN/fake.log 2>&1 & FPID=$!
node $H/vendor-server.mjs $VP $RUN/vendor.jsonl > $RUN/vendor.log 2>&1 & VPID=$!
node $H/vendor-server.mjs $EP $RUN/exfil.jsonl > $RUN/exfil.log 2>&1 & EPID=$!
for i in $(seq 1 120); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$DP/health 2>/dev/null | grep -q 200 && break; sleep 0.5; done
PW_PATH=$S/wt-head/node_modules/playwright node $H/${DRIVER:-drive-r5.cjs} $ENGINE $ARM http://$HOST:$DP $RUN $S/r7/out/$RUNNAME "${DRV[@]}"
RC=$?
kill $FPID $VPID $EPID 2>/dev/null; DPID=$(cat $RUN/daemon.pid); kill $DPID 2>/dev/null; sleep 1; pkill -P $DPID 2>/dev/null
echo "CASE_DONE $RUNNAME rc=$RC"
