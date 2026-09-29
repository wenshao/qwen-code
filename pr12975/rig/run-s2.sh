#!/bin/bash
# usage: run-s2.sh <arm> <db> <http> <bport>
ARM=$1; DB=$2; HTTP=$3; BPORT=$4
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/wt-merge
: > ../rig/out/s2-$ARM.stdout
for pair in SHELL_PAIR:a SHELL_RM:b EDIT_OLD:c WRITE_HALF:d; do
  ONLY=${pair%%:*} ST=${pair##*:} ARM=$ARM DB=$DB HTTP=$HTTP BPORT=$BPORT ROOTS=roots-$ARM $N --import tsx ../rig/s1-surrogate.ts >> ../rig/out/s2-$ARM.stdout 2>&1
  cp ../rig/out/s1-surrogate-$ARM.json ../rig/out/s2-$ARM-${pair%%:*}.json
done
echo ALL-DONE >> ../rig/out/s2-$ARM.stdout
