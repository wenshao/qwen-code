#!/bin/bash
# usage: RUNNAME=x run-case.sh <arm> <basePort> <engine> <pageHost> [driver flags...] -- [serve flags...]
S=$SCRATCH; H=$S/r4/harness
ARM=$1; P=$2; ENGINE=$3; HOST=$4; shift 4
DRV=(); while [ $# -gt 0 ] && [ "$1" != "--" ]; do DRV+=("$1"); shift; done; [ "$1" = "--" ] && shift
DP=$P; FP=$((P+1)); VP=$((P+2)); EP=$((P+3))
export RUNNAME=${RUNNAME:-$ARM-$ENGINE}; RUN=$S/r4/run-$RUNNAME
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; export NO_PROXY='*' no_proxy='*'
$H/start-arm.sh $ARM $DP $FP $VP $EP "$@" &
DPID=$!
sleep 1
node $H/fake-openai.mjs $FP $RUN/openai.jsonl > $RUN/fake.log 2>&1 & FPID=$!
node $H/vendor-server.mjs $VP $RUN/vendor.jsonl > $RUN/vendor.log 2>&1 & VPID=$!
node $H/vendor-server.mjs $EP $RUN/exfil.jsonl > $RUN/exfil.log 2>&1 & EPID=$!
for i in $(seq 1 120); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$DP/health 2>/dev/null | grep -q 200 && break; sleep 0.5; done
PW_PATH=$S/pw/node_modules/playwright node $H/${DRIVER:-drive-r4.cjs} $ENGINE $ARM http://$HOST:$DP $RUN $S/r4/out/$RUNNAME "${DRV[@]}"
RC=$?
kill $FPID $VPID $EPID 2>/dev/null; kill $(cat $RUN/daemon.pid) 2>/dev/null; sleep 1; pkill -P $(cat $RUN/daemon.pid) 2>/dev/null
echo "CASE_DONE $RUNNAME rc=$RC"
