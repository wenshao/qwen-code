#!/bin/bash
# usage: run-diff.sh <tag> <ts-dist-dir> <java-classes-dir> <count> <seeds...>
TAG=$1; TSD=$2; JCD=$3; N=$4; shift 4
FX=/root/verify/pr13548/head-r3/packages/core/src/managed-runtime/contracts/managed-channel-record-v1.fixtures.json
CP=/root/verify/pr13548/harness/javaeval-out-r3:$JCD:$(cat /root/verify/pr13548/cp-head-r3.txt)
mkdir -p /root/verify/pr13548/diff-r3/$TAG; cd /root/verify/pr13548/diff-r3/$TAG
for seed in "$@"; do
  ( node /root/verify/pr13548/harness/gen.mjs $FX $N $seed > cases-$seed.jsonl
    node /root/verify/pr13548/harness/ts-eval.mjs $TSD < cases-$seed.jsonl > ts-$seed.txt &
    /root/Install/jdk21/bin/java -Xmx2g -cp "$CP" com.alibaba.qwen.code.managedagent.store.ChannelDiffEval < cases-$seed.jsonl > java-$seed.txt &
    wait ) &
done
wait
for seed in "$@"; do diff <(sort ts-$seed.txt) <(sort java-$seed.txt) > diff-$seed.txt; echo "seed=$seed lines=$(wc -l < ts-$seed.txt) difflines=$(wc -l < diff-$seed.txt)"; cut -f2- ts-$seed.txt | sort | uniq -c > hist-$seed.txt; [ -n "$KEEP" ] || rm -f cases-$seed.jsonl ts-$seed.txt java-$seed.txt; done
