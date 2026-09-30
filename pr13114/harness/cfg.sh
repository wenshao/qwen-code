#!/bin/bash
# PR #13114: deployment budget fail-closed checks on the real server jar (Spring startup only).
R=$(cd $(dirname $0); pwd); LOG=$R/out/cfg.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
try() {
  local label=$1 jar=$2; shift 2
  $R/stop-spring.sh
  local f=$R/run/cfg-$(echo $label | cut -d' ' -f1).log
  (cd $R && env "$@" JAR_ARM=$jar WT=/Users/wenshao/git/qwen-code-pr13114 STORAGES="p01" ROOTS=$R/roots-cfg nohup ./spring.sh p13cfg 18894 19894 > $f 2>&1 & echo $! > $R/run/cfg.pid)
  local pid=$(cat $R/run/cfg.pid) res=""
  for i in $(seq 1 180); do
    if curl -s http://127.0.0.1:18894/actuator/health 2>/dev/null | grep -q UP; then res="STARTED (health UP)"; break; fi
    if ! kill -0 $pid 2>/dev/null; then res="EXITED"; break; fi
    sleep 1
  done
  [ -z "$res" ] && res="TIMEOUT"
  local cause=$(grep -E "^Caused by: " $f | tail -1 | sed -E "s/^Caused by: [a-zA-Z.]*\\.//" | cut -c1-170)
  say "$label | jar=$jar | $* | $res | ${cause:-}"
  $R/stop-spring.sh; kill $pid 2>/dev/null; sleep 1
}
try "C1 no budget properties" head-0cc562d4 PUB_VBPS=none
try "C2 floor set, max missing" head-0cc562d4 PUB_VBPS=16777216 PUB_VMAX=none
try "C3 max 26m (> 25m cap)" head-0cc562d4 PUB_VBPS=16777216 PUB_VMAX=26m
try "C4 floor 1 MiB/s: 120s + 2 GiB/1 MiB/s > 25m" head-0cc562d4 PUB_VBPS=1048576 PUB_VMAX=25m
try "C5 max 60s < operation-timeout 120s" head-0cc562d4 PUB_VBPS=16777216 PUB_VMAX=60s
try "C6 floor 0" head-0cc562d4 PUB_VBPS=0 PUB_VMAX=25m
try "C7 valid: floor 16 MiB/s, max 25m" head-0cc562d4 PUB_VBPS=16777216 PUB_VMAX=25m
try "C8 exact fit: floor 2 MiB/s, exec 2 GiB, max 1146s" head-0cc562d4 PUB_VBPS=2097152 PUB_VMAX=1146s
try "C9 one second short: max 1145s" head-0cc562d4 PUB_VBPS=2097152 PUB_VMAX=1145s
try "C10 O2 disabled, no budget" head-0cc562d4 PUB=0 PUB_VBPS=none
try "C11 base jar with the new properties" base-3b18cfe5 PUB_VBPS=16777216 PUB_VMAX=25m
say "## done $(date +%T)"
