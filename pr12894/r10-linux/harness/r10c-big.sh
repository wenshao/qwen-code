#!/bin/bash
# r10 rerun: 1 GiB with an explicit 10-minute Shell timeout (this host generates ~610 MiB per 120 s).
R=$(cd $(dirname $0); pwd); TSX=/root/git/qwen-code-c2/node_modules/.bin/tsx
export DB=o2r11 HARNESS_WT=/root/git/qwen-code-c2 ROOTS=$R/roots-r11 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r10c-1gib.log; : > $LOG
cd $R
echo "=== A 1GiB rerun, SHELL_TIMEOUT=600000 ($(date +%T))" | tee -a $LOG
env SCRIPT=s1-big-shell.ts TAG=r10g1b ST=s04 SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000 SHELL_TIMEOUT=600000 $TSX $R/s1-big-shell.ts 2>&1 | grep -E "^\[(turn|side-effects|bytes|catalog|range|oss|status|acquire|detach|worker-rss)" | cut -c1-260 | tee -a $LOG
echo "## 1gib done" | tee -a $LOG
