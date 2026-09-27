#!/bin/bash
# Usage: sweep.sh <label> <trials> <sizeMiB>...   (REPO env selects the worktree)
# Each trial = fresh Session root + real host + curl execute; records the outcome.
H=$(cd "$(dirname "$0")" && pwd)
LABEL=$1; TRIALS=$2; shift 2
REPO=${REPO:-/Users/wenshao/git/qwen-code-pr12821}
SUM=$H/out/sweep-$LABEL.tsv
echo -e "size_mib\ttrial\tcaptureStatus\tcaptureReason\tdeliveryStatus\tphase\tseal_refusals\tdup_ordinals" > "$SUM"
for size in "$@"; do
  for t in $(seq 1 "$TRIALS"); do
    name=sw-$LABEL-$size-$t
    TRACE=1 REPO=$REPO "$H/scenario.sh" "$name" "$size 64" > /dev/null 2>&1
    OUT=$H/out/$name
    cs=$(jq -r '.result.capture.captureStatus' "$OUT/execute.json" 2>/dev/null)
    cr=$(jq -r '.result.capture.captureReason' "$OUT/execute.json" 2>/dev/null)
    ds=$(jq -r '.result.capture.deliveryStatus' "$OUT/execute.json" 2>/dev/null)
    cp=$(grep '^checkpoint' "$OUT/driver.log" | sed 's/checkpoint -> //')
    ph=$(echo "$cp" | jq -r .phase)
    sr=$(echo "$cp" | jq '[.faultLog[] | select(startswith("seal ") )] | length')
    dup=$(echo "$cp" | jq -r '[.faultLog[] | select(startswith("pub ")) | split(" ")[1]] | group_by(.) | map(select(length>1) | .[0]) | join(",")')
    echo -e "$size\t$t\t$cs\t$cr\t$ds\t$ph\t$sr\t${dup:--}" | tee -a "$SUM"
    kill -TERM "$(cat "$OUT/hostpid")" 2>/dev/null; sleep 0.3
    rm -rf "$(cat "$OUT/root")"
  done
done
