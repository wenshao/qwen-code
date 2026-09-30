#!/bin/bash
# Round 15 real Aliyun OSS: R4-1 entrances with faults injected in the TLS tunnel to OSS
# (connect-proxy.mjs), then the natural finish read-back time.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
export DB=o5r HARNESS_WT=$HOME/git/qwen-code-pr12894 ROOTS=$R/roots-r15 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token REAL_OSS=1 LEDGER_LINES=20
LOG=$R/out/ro15-0027f7a7.log; : > $LOG
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
A='"armUrl":"http://127.0.0.1:18898/arm"'
start_real 6s 3s
run "RF1 baseline (6 s / 3 s)" TAG=ro15f1 ST=s81
run "RF2 segment stdout/2: its PUT body held 9 s in the tunnel" TAG=ro15f2 ST=s82 RULES="[{\"match\":\"/segments/stdout/2(\\\\?|\$)\",\"action\":\"arm-oss\",$A,\"count\":1,\"oss\":{\"ms\":9000,\"dir\":\"up\",\"minBytes\":65536}}]"
run "RF7 same, and the reply to the producer is lost" TAG=ro15f7 ST=s83 RULES="[{\"match\":\"/segments/stdout/2(\\\\?|\$)\",\"action\":\"arm-oss-drop-reply\",$A,\"count\":1,\"oss\":{\"ms\":9000,\"dir\":\"up\",\"minBytes\":65536}}]"
run "RF3 finish: a read-back GET body held 9 s in the tunnel" TAG=ro15f3 ST=s84 RULES="[{\"match\":\"/finish(\\\\?|\$)\",\"action\":\"arm-oss\",$A,\"count\":1,\"oss\":{\"ms\":9000,\"dir\":\"down\",\"minBytes\":65536}}]"
run "RF8 same, and the reply to the producer is lost" TAG=ro15f8 ST=s85 RULES="[{\"match\":\"/finish(\\\\?|\$)\",\"action\":\"arm-oss-drop-reply\",$A,\"count\":1,\"oss\":{\"ms\":9000,\"dir\":\"down\",\"minBytes\":65536}}]"
say "connect proxy holds: $(curl -s http://127.0.0.1:18898/ledger | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).filter(e=>e.hold))))')"
start_real 120s 30s
T0=$(node -e 'console.log(Date.now())')
SCRIPT=s1-big-shell.ts run "RT1 100 MiB + 5 MiB, default-like 120 s / 30 s: how long the finish read-back takes" TAG=ro15m100 ST=s86 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000 SHELL_TIMEOUT=600000
finish_ms $T0
say "## done"
