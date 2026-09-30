#!/bin/bash
# Round 15 real Aliyun OSS: R4-1 entrances with faults injected in the TLS tunnel to OSS
# (connect-proxy.mjs), then the natural finish read-back time.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
export DB=o5r HARNESS_WT=$HOME/git/qwen-code-pr12894 ROOTS=$R/roots-r15 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token REAL_OSS=1 LEDGER_LINES=20
LOG=$R/out/ro15b-0027f7a7.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|ops-|bytes|harness|status|oss-verify|model-saw-bytes)" | grep -v "harness.*\[\]$" | cut -c1-330 | tee -a $LOG; }
stop_spring() {
  local sp; sp=$(lsof -nP -iTCP:18894 -sTCP:LISTEN -t); [ -z "$sp" ] && return
  ps -o command= -p $sp | grep -q "server.port=18894" || { say "18894 is not the rig Spring"; exit 1; }
  local tp; tp=$(ps -ax -o pid=,command= | awk '/[E]xTap 15894/{print $1}')
  kill $sp $tp $(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}') 2>/dev/null
  for i in $(seq 1 30); do lsof -nP -iTCP:18894 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
}
start_real() { # operation-timeout claim-timeout
  stop_spring
  PUB_OPTIMEOUT=$1 PUB_CLAIM=$2 SPRING_SH=spring-real.sh JVM_POST="-Djdk.net.hosts.file=$R/realoss-hosts" DB=$DB ROOTS=$ROOTS BROKER_TOKEN=$BROKER_TOKEN PUB_PORT=18895 $R/up-real15.sh pr15 $HARNESS_WT | tee -a $LOG
  say "## real OSS bucket $(sed 's/-[0-9a-f]*$/-xxxxxx/' $R/../realoss/bucket.txt), operation-timeout=$1 claim-timeout=$2; OSS connections via the TCP forwarder: $(curl -s http://127.0.0.1:18898/ledger | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(e=>e.open).length))')"
}
finish_ms() { curl -s "http://127.0.0.1:18896/ledger?since=$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);for(const e of l.filter(e=>/\/finish(\?|$)/.test(e.url)))console.log(`    finish ${e.status} ${e.ms} ms`);const seg=l.filter(e=>/\/segments\//.test(e.url)&&e.ms);if(seg.length)console.log(`    segment requests ${seg.length}, max ${Math.max(...seg.map(e=>e.ms))} ms, median ${seg.map(e=>e.ms).sort((a,b)=>a-b)[seg.length>>1]} ms`)})' | tee -a $LOG; }
cd $R
start_real 10s 5s
T0=$(node -e 'console.log(Date.now())')
SCRIPT=s1-big-shell.ts run "RT2 100 MiB + 5 MiB with operation-timeout 10 s, no injected faults (head)" TAG=ro15t2 ST=s87 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000 SHELL_TIMEOUT=600000
finish_ms $T0
say "  catalog: $(DB=$DB $R/sql.sh -N -B -e "SELECT CONCAT(state,'/',producer_phase) FROM qwen_tool_publication p JOIN qwen_tool_publication_operation o USING (scope_key, publication_id) WHERE o.operation_id='finish' ORDER BY o.created_at DESC LIMIT 1")"
export HARNESS_WT=$HOME/git/qwen-code-pr12894-cand15
start_real 10s 5s
T0=$(node -e 'console.log(Date.now())')
SCRIPT=s1-big-shell.ts run "RT3 same, candidate client change (EXPIRED after a 4xx goes to recovery)" TAG=ro15t3 ST=s88 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000 SHELL_TIMEOUT=600000
finish_ms $T0
say "## done"
