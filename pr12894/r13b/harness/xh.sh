#!/bin/bash
# Second host: Harness on root@<second-host> (Orange Pi, linux-arm64) through ssh tunnels; Spring, MySQL, workers on this Mac; real Aliyun OSS.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
export DB=o3a HARNESS_WT=$HOME/git/qwen-code-pr12894 ROOTS=$R/roots-real JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token REAL_OSS=1 REMOTE_HARNESS_HOST=root@<second-host>
LOG=$R/out/xh-42e2e8b1.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|reload|status after|second turn|hold|crash|load|harness|journal|history|assistant)|^\[[a-zA-Z0-9]|^\[  |Error" | grep -v "harness.*\[\]$\|writers:acquire" | cut -c1-260 | tee -a $LOG; }
cd $R
say "## second host $(ssh -o BatchMode=yes root@<second-host> 'hostname; uname -sm; node -v' | tr '\n' ' ') load $(uptime | sed 's/.*averages: //')"
run "X crash after receipt: Mac Harness killed, Pi Harness recovers" TAG=xmp ST=s17 HOLD_KILL='/receipts/commit' REMOTE_HARNESS_NAMES='-2$'
run "X crash after receipt: Pi Harness killed, Mac Harness recovers" TAG=xpm ST=s18 HOLD_KILL='/receipts/commit' REMOTE_HARNESS_NAMES='^s3-xpm$'
run "X control chars + crash after receipt: Mac -> Pi" TAG=xcc ST=s19 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit' REMOTE_HARNESS_NAMES='-2$'
run "X local capture path, Harness on the Pi" LOCAL=1 TAG=xpl ST=s20 REMOTE_HARNESS_NAMES='.*'
SCRIPT=s18-handoff.ts run "X clean hand-off Mac -> Pi -> Mac (O2)" TAG=xho ST=s21 REMOTE_HARNESS_NAMES='-B$'
SCRIPT=s18-handoff.ts run "X clean hand-off Mac -> Pi -> Mac (local)" LOCAL=1 TAG=xhl ST=s22 REMOTE_HARNESS_NAMES='-B$'
say "## done load $(uptime | sed 's/.*averages: //')"
