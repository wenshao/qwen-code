#!/bin/bash
# Paired A/B at the same moment: lane 1 = head async (B), lane 2 = base sync (A). usage: paired.sh "<groups>"
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr13654/node_modules/.bin/tsx
HEAD=${CAND:-$HOME/git/qwen-code-pr13654}; BASE=$HOME/git/qwen-code-pr13654-base
LOG=$R/out/${PLOG:-paired}.log; n=${N0:-0}
say() { echo "$*" | tee -a $LOG; }
pair() { local label=$1; shift; n=$((n+1)); local T=$(date +%s)
  say "=== P$n $label ($(date +%T)) load $(uptime | sed 's/.*averages: //') :: $*"
  env JSON_TIMEOUT=900000 HTTP_PORT=18654 BROKER_PORT=19654 PUB_PORT=18655 DB=${DB1:-p654p1} WT=$HEAD HARNESS_WT=$HEAD ST=$(printf 's%02d' $n) TAG=${PB:-pb}$n-$T "$@" $TSX $R/s654.ts > $R/out/pair-$n-B.txt 2>&1 &
  local pb=$!
  env JSON_TIMEOUT=900000 HTTP_PORT=18664 BROKER_PORT=19664 PUB_PORT=18665 DB=${DB2:-p654p2} WT=$BASE HARNESS_WT=$BASE ST=$(printf 's%02d' $n) TAG=pa$n-$T "$@" $TSX $R/s654.ts > $R/out/pair-$n-A.txt 2>&1 &
  local pa=$!
  wait $pb; wait $pa
  for a in A B; do grep -E "^\[(turn|tool|side-effects|requests|request-latency|ops)\]|^\[bytes stdout" $R/out/pair-$n-$a.txt | grep -v '"call run_shell' | sed "s/^/  $a /" | cut -c1-240 | tee -a $LOG; done
  node $R/perop.mjs $(ls -t $R/out/s654-${PB:-pb}$n-$T.json $R/out/s654-pa$n-$T.json 2>/dev/null) | sed 's/^/  /' | tee -a $LOG
}
for g in $1; do case $g in
  S) for i in 1 2 3; do pair "16 MiB stdout, storage unthrottled (rep $i)" SO=16777216 SE=4096; done;;
  T) for i in 1 2 3; do pair "16 MiB stdout, object GET 4 MiB/s (rep $i)" SO=16777216 SE=4096 GET_BPS=4194304; done;;
  M) for i in 1 2; do pair "128 MiB stdout, storage unthrottled (rep $i)" SO=134217728 SE=4096 CAPTURE=1073741824; done;;
  X) for i in 1 2; do pair "512 MiB stdout until the default 120 s Shell timeout (rep $i)" SO=536870912 SE=4096 CAPTURE=1073741824; done;;
esac; done
say "## paired done $(date +%T)"
