#!/bin/bash
# container: run one mode of the PR's own runner N times.  usage: e2e-once.sh <mode-flag> <label> <runs>
MODE=$1; L=$2; N=${3:-1}
O=/rig/out/e2e; mkdir -p $O
pass=0
for i in $(seq 1 $N); do
  s=$(date +%s%N)
  tsx scripts/run-managed-agent-server-e2e.ts $MODE > $O/$L-$i.out 2> $O/$L-$i.err; rc=$?
  e=$(date +%s%N)
  [ $rc -eq 0 ] && pass=$((pass+1))
  echo "[$L] run $i exit=$rc $(( (e - s) / 1000000 )) ms"
done
echo "[$L] PASS ${pass}/${N}"
