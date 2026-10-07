#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 5): TS + Java evaluation of one corpus on one arm, then compare.
# usage: diff-run.sh <label> <worktree> <corpus-name>
set -u
D=/Users/wenshao/git/pr13505-rig/diff; RIG=/Users/wenshao/git/pr13505-rig; L=$1; W=$2; C=$3
CP="$D/jcls-$L:$RIG/jx-$L/BOOT-INF/classes:$RIG/jx-$L/BOOT-INF/lib/*"
( s=$(date +%s); nice /Users/wenshao/Install/jdk21/bin/java -Xmx4g -cp "$CP" JavaEval $D/$C.jsonl $D/java-$L-$C.jsonl; echo "java exit=$? $(( $(date +%s)-s ))s" ) > $D/run-$L-$C-java.log 2>&1 &
( s=$(date +%s); nice node --max-old-space-size=4096 $D/ts-eval.mjs $W/packages/core/dist/src $D/$C.jsonl $D/ts-$L-$C.jsonl; echo "ts exit=$? $(( $(date +%s)-s ))s" ) > $D/run-$L-$C-ts.log 2>&1 &
wait
python3 $D/compare.py $D/$C.jsonl $D/ts-$L-$C.jsonl $D/java-$L-$C.jsonl > $D/compare-$L-$C.txt 2>&1
echo "DIFF-DONE $L $C $(date -u +%T)"
