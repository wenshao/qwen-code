#!/bin/bash
# Round 15 second host: Harness on root@<second-host> (0027f7a7 build in /root/git/qwen-code-pr12894-rv15); Spring, MySQL, workers, fake OSS on this Mac.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
export DB=o5a HARNESS_WT=$HOME/git/qwen-code-pr12894 ROOTS=$R/roots-r15 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token REMOTE_HARNESS_HOST=root@<second-host> REMOTE_HARNESS_WT=/root/git/qwen-code-pr12894-rv15
LOG=$R/out/xh-0027f7a7.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|reload|status after|second turn|hold|crash|load|harness|journal|history|assistant)|^\[[a-zA-Z0-9]|^\[  |Error" | grep -v "harness.*\[\]$\|writers:acquire" | cut -c1-300 | tee -a $LOG; }
cd $R
say "## second host $(ssh -o BatchMode=yes root@<second-host> 'hostname; uname -sm; node -v; git -C /root/git/qwen-code-pr12894-rv15 log --format=%s -1' | tr '\n' ' ') load $(uptime | sed 's/.*averages: //')"
run "X crash after receipt: Mac Harness killed, Pi Harness recovers" TAG=r15xmp ST=s71 HOLD_KILL='/receipts/commit' REMOTE_HARNESS_NAMES='-2$'
run "X crash after receipt: Pi Harness killed, Mac Harness recovers" TAG=r15xpm ST=s72 HOLD_KILL='/receipts/commit' REMOTE_HARNESS_NAMES='^s3-r15xpm$'
SCRIPT=s18-handoff.ts run "X clean hand-off Mac -> Pi -> Mac (O2)" TAG=r15xho ST=s73 REMOTE_HARNESS_NAMES='-B$'
SCRIPT=s21-resume-busy.ts run "X resume acquire reply lost, B on the Pi" TAG=r15xal ST=s74 MODE=acquire-lost REMOTE_HARNESS_NAMES='-B$'
SCRIPT=s22-approval.ts run "X approvals with the Harness on the Pi (O2)" LABEL=xap ST_BASE=75 CASES=allow,pair REMOTE_HARNESS_NAMES='.*'
say "## done load $(uptime | sed 's/.*averages: //')"
