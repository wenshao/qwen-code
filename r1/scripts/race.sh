#!/bin/bash
# usage: race.sh <jdbc-url> <label> [workers] [threads] [scopes] [churnSec]
. /root/verify/pr12390-harness/env.sh
URL=$1; LABEL=$2; W=${3:-8}; T=${4:-8}; S=${5:-20}; CH=${6:-20}
RUN="r$(date +%s)"; OUT=$H/logs/race-$LABEL; rm -rf $OUT; mkdir -p $OUT
P=com.alibaba.qwen.code.runtimebroker.RaceWorker
java -cp $CP com.alibaba.qwen.code.runtimebroker.TzProbe single "$URL" init >/dev/null 2>&1   # schema
START=$(( $(date +%s%3N) + 6000 ))
for w in $(seq 1 $W); do java -Xmx256m -cp $CP $P race "$URL" $RUN w$w $T $START $S $CH > $OUT/w$w.out 2>&1 & done
wait
printf '\033[1;36m### %s: %d JVMs x %d threads, barrier start, %d scopes, %ds churn (run %s)\033[0m\n' "$LABEL" $W $T $S $CH $RUN
echo "Phase A  findOrCreate calls returned : $(cat $OUT/*.out | grep -c '^CREATE')  (expected $((W*T*S)))"
echo "Phase A  distinct (scope,binding,gen)  : $(cat $OUT/*.out | grep '^CREATE' | sort -u | wc -l)  (expected $S = one binding per scope, all generation 1)"
echo "Phase A  generations seen              : $(cat $OUT/*.out | grep '^CREATE' | awk '{print $4}' | sort -u | tr '\n' ' ')"
echo "Phase A  JVMs that won a creation      : $(cat $OUT/*.out | grep '^CREATE' | awk '{print $3}' | sort -u | sed -E 's/.*-(w[0-9]+)-t[0-9]+-[0-9]+$/\1/' | sort | uniq -c | awk '{printf "%s:%s ", $2, $1}')"
echo "Phase B  claim granted / fenced        : $(cat $OUT/*.out | grep '^CLAIM' | grep -vc null) / $(cat $OUT/*.out | grep -c '^CLAIM null')  (expected 1 / $((W*T-1)))"
echo "Phase B  winner                        : $(cat $OUT/*.out | grep '^CLAIM' | grep -v null | sort -u)"
echo "Phase C  totals across all JVMs:"
cat $OUT/*.out | grep '^COUNT' | awk '{n=$2; $1="";$2=""; a[$0]+=n} END {for (k in a) printf "   %8d %s\n", a[k], k}' | sort -k2
echo "DB invariants after the run:"
java -cp $CP $P check "$URL" $RUN 2>&1 | grep -v Picked | sed 's/^/   /'
