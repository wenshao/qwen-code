#!/bin/bash
# usage: run.sh <log> <label> VAR=... (scenario env); appends filtered output to out/<log>.log
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr13654/node_modules/.bin/tsx
LOG=$R/out/$1.log; LABEL=$2; shift 2
echo "=== $LABEL ($(date +%T)) $*" | tee -a $LOG
env JSON_TIMEOUT=900000 "$@" $TSX $R/s654.ts 2>&1 | grep -E "^\[(create|submit|hold|during-hold|driver-error|corrupt|restart|release|replay|turn|tool|model-saw|oss|side-effects|requests|request-latency|proxy-|catalog|objects|ops|bytes|status|harness)" | grep -v "harness\] \[\]$" | cut -c1-600 | tee -a $LOG
