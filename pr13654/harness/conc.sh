#!/bin/bash
# Concurrent sessions on the currently running Spring. usage: conc.sh <label> <K> <logname> VAR=... (passed to every run)
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr13654/node_modules/.bin/tsx
LABEL=$1; K=$2; LOG=$R/out/$3.log; shift 3
SPRINGLOG=$(ls -t $R/run/spring-*.log | head -1)
echo "=== $LABEL K=$K ($(date +%T)) $* spring-log=$(basename $SPRINGLOG)" | tee -a $LOG
T0=$(date +%s); L0=$(wc -l < $SPRINGLOG)
pids=()
for i in $(seq 1 $K); do
  env JSON_TIMEOUT=900000 "$@" ST=$(printf "s%02d" $((${OFF:-30}+i))) TAG=$(echo $LABEL | tr -dc 'a-z0-9')-$i-$T0 $TSX $R/s654.ts > $R/out/conc-$T0-$i.txt 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait $p; done
T1=$(date +%s)
for i in $(seq 1 $K); do grep -E "^\[(turn|requests|request-latency|bytes stdout|ops)\]" $R/out/conc-$T0-$i.txt | sed "s/^/  s$i /" | cut -c1-260; done | tee -a $LOG
echo "  wall ${LABEL}: $((T1-T0)) s for $K sessions" | tee -a $LOG
tail -n +$((L0+1)) $SPRINGLOG | grep -o "queueMillis=[0-9]* verificationMillis=[0-9]*" | node -e '
const l=require("fs").readFileSync(0,"utf8").trim().split("\n").filter(Boolean).map(x=>x.match(/\d+/g).map(Number));
if(!l.length){console.log("  verifier: no async verifications logged");process.exit(0)}
const q=l.map(x=>x[0]).sort((a,b)=>a-b), v=l.map(x=>x[1]).sort((a,b)=>a-b), p=(a,f)=>a[Math.min(a.length-1,Math.floor(f*a.length))], m=a=>Math.round(a.reduce((x,y)=>x+y,0)/a.length);
console.log(`  verifier: ${l.length} ops; queueMillis mean ${m(q)} p50 ${p(q,.5)} p90 ${p(q,.9)} max ${q.at(-1)}; verificationMillis mean ${m(v)} p90 ${p(v,.9)}`)' | tee -a $LOG
