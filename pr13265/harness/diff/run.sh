#!/bin/bash
# usage: run.sh <wt> <tag> [N]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
D=$SP/rig/diff; WT=$SP/$1; TAG=$2; N=${3:-200000}
CP="$WT/packages/sdk-java/managed-agent-server/target/classes:$(cat $SP/rig/cp.txt)"
mkdir -p $D/$TAG
WT=$WT N=$N OUT=$D/$TAG/cands.jsonl node $D/gen.mjs || exit 1
~/Install/jdk21/bin/javac -d $D/$TAG/cls -cp "$CP" $D/Drive.java || exit 1
( time WT=$WT IN=$D/$TAG/cands.jsonl OUT=$D/$TAG/ts.tsv node $D/ts-drive.mjs ) 2>&1 | grep real
( time ~/Install/jdk21/bin/java -cp "$D/$TAG/cls:$CP" Drive $D/$TAG/cands.jsonl $D/$TAG/java.tsv ) 2>&1 | grep real
echo "lines: cands=$(wc -l < $D/$TAG/cands.jsonl) ts=$(wc -l < $D/$TAG/ts.tsv) java=$(wc -l < $D/$TAG/java.tsv)"
