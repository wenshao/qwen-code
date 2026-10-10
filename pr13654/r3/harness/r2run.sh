#!/bin/bash
# One scenario on a lane. usage: r2run.sh <lane> <log> <label> VAR=...
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr13654/node_modules/.bin/tsx
L=$1; LOG=$R/out/$2.log; LABEL=$3; shift 3
P=$((18644+10*L)); B=$((19644+10*L)); PUB=$((18645+10*L))
echo "=== $LABEL ($(date +%T)) lane $L load $(uptime | sed 's/.*averages: //') :: $*" | tee -a $LOG
env JSON_TIMEOUT=900000 HTTP_PORT=$P BROKER_PORT=$B PUB_PORT=$PUB "$@" $TSX $R/s654.ts 2>&1 | grep -E "^\[(create|submit|hold|during-hold|driver-error|lapse|corrupt|restart|release|replay|turn|tool|model-saw|side-effects|requests|request-latency|proxy-|catalog|objects|ops|bytes|status|harness)" | grep -v "harness\] \[\]$" | cut -c1-600 | tee -a $LOG
