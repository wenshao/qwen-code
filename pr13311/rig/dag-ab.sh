#!/bin/bash
# usage: dag-ab.sh <label> <wt> <mode> <timeout-s> N...
label=$1; wt=$2; mode=$3; to=$4; shift 4
for n in "$@"; do
  start=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  out=$(perl -e 'alarm shift; exec @ARGV' "$to" node probe-records.mjs "$label" "$wt" "$mode" "$n" 2>&1); code=$?
  end=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  wall=$(echo "$end - $start" | bc)
  if [ -n "$out" ]; then echo "$out	wall=${wall}s"; else echo "RESULT	$label	$mode	N=$n	KILLED-after-${to}s(exit=$code)	wall=${wall}s"; fi
done
