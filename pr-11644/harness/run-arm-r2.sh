#!/bin/bash
# run-arm-r2.sh <arm> <batch> [<batch> ...]
# Each batch is a comma-separated list of script[:TARGET]; scripts in one batch run concurrently,
# batches run in order. The bundle swap + daemon restart happens once up front.
set -uo pipefail
ARM=$1; shift
cd /root/git/h11644; export OUTDIR=r2/
mkdir -p out/r2
./killd.sh; sleep 2
./start-daemon.sh "$ARM" || exit 1
sleep 3
for batch in "$@"; do
  echo "== [$ARM] batch $batch $(date +%T)"
  IFS=',' read -ra items <<< "$batch"
  for it in "${items[@]}"; do
    script=${it%%:*}; target=""; [ "$it" != "$script" ] && target=${it#*:}
    tag="${script%.mjs}-$ARM${target:+-$target}"
    if [ -n "$target" ]; then TARGET=$target timeout 300 node "$script" "$ARM" > "out/r2/$tag.log" 2>&1 &
    else timeout 300 node "$script" "$ARM" > "out/r2/$tag.log" 2>&1 & fi
  done
  wait
done
echo "== [$ARM] done $(date +%T)"
for f in out/r2/*-$ARM*.log; do echo "--- $f: exit-lines=$(grep -c '"arm"' $f) pageerrors=$(grep -c pageerror $f)"; done
