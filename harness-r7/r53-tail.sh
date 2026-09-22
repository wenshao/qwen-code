#!/bin/bash
# R5-3 re-measure: consumer reads first 1 MiB, stalls 3 s; producer pauses 1 s, writes tail of T bytes.
# Reported lost bytes at prev head were 4464 (T=70000) / 24464 (T=90000) / 0 (T=200000). Tracked in #12417.
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
cd "$ART/scratch"
Q="$ART/harness-r7/q.sh"
for ARM in "$@"; do
  for T in 70000 90000 200000; do
    got=$( (cat "$ART/scratch/ws/rand1m.bin"; sleep 1; head -c $T /dev/zero) | timeout -k 2 60 $Q $ARM ww-closed sandbox -- cat 2>/dev/null | python3 "$ART/harness-r7/burst-reader.py" 1048576 3 )
    exp=$((1048576 + T))
    echo "$ARM T=$T expected=$exp got=$got lost=$((exp - got))"
  done
done
