#!/bin/bash
# VERIFICATION RIG ONLY (PR #13536): run the full-code-point sweep field by field.
# usage: bmp-run.sh <label> <worktree>   (needs jx-<label> and jcls-<label>)
set -u
D=/Users/wenshao/git/pr13536-rig/diff; RIG=/Users/wenshao/git/pr13536-rig; L=$1; W=$2
T=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2d997886-adf9-4361-92bb-b94fda0222eb/scratchpad/bmp-$L; mkdir -p $T
export FIXDIR=${SEEDFIX:-$W/packages/core/src/managed-runtime/contracts/}
CP="$D/jcls-$L:$RIG/jx-$L/BOOT-INF/classes:$RIG/jx-$L/BOOT-INF/lib/*"
S=$D/bmp-$L-summary.tsv; X=$D/bmp-$L-diff.jsonl; : > $S; : > $X
N=$(python3 $D/gen-bmp.py list | wc -l | tr -d ' ')
for ((i=0;i<N;i++)); do
  lab=$(python3 $D/gen-bmp.py list | sed -n "$((i+1))p" | cut -f2,3 | tr '\t' ' ')
  python3 $D/gen-bmp.py $i $T/rows.jsonl 2>/dev/null || { echo "GEN-FAIL $i" >> $S; continue; }
  /Users/wenshao/Install/jdk21/bin/java -Xmx2g -cp "$CP" JavaEval $T/rows.jsonl $T/java.jsonl 2>/dev/null & jp=$!
  node --max-old-space-size=4096 $D/ts-eval.mjs $W/packages/core/dist/src $T/rows.jsonl $T/ts.jsonl 2>/dev/null; te=$?
  wait $jp; je=$?
  if [ $te -ne 0 ] || [ $je -ne 0 ]; then echo "EVAL-FAIL $i ts=$te java=$je" >> $S; continue; fi
  python3 $D/bmp-compare.py $T/rows.jsonl $T/ts.jsonl $T/java.jsonl "$lab" >> $S 2>> $X || echo "CMP-FAIL $i" >> $S
done
rm -f "${T:?}"/rows.jsonl "${T:?}"/ts.jsonl "${T:?}"/java.jsonl
echo "BMP-DONE $L fields=$N $(date -u +%T)" >> $S
