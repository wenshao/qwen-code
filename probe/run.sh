#!/bin/bash
# probe/run.sh <lane: inherit|cmd|bash> <repeats> <arms...>; run from the repo root.
set -u
LANE=$1; REPEATS=$2; shift 2
OUT=probe-out/$LANE
mkdir -p "$OUT"
lane_env() {
  case $LANE in
    inherit) env "$@" ;;
    cmd) env PROBE_UNSET_GITBASH=1 "$@" ;;
    bash) env MSYSTEM=MINGW64 "$@" ;;
  esac
}
for ARM in "$@"; do
  node probe/transform.mjs "$ARM" "$REPEATS" || continue
  case $ARM in
    *-full) FILTER=() ;;
    probe) FILTER=(-t 'PROBE' --silent=false) ;;
    *) FILTER=(-t 'refuses release while an invocation is active|retains status and cancel for an active invocation') ;;
  esac
  START=$(date +%s)
  ( cd packages/cli && lane_env npx vitest run src/serve/managed-context-worker.test.ts "${FILTER[@]}" \
      --reporter=default --reporter=json --outputFile.json="../../$OUT/$ARM.json" > "../../$OUT/$ARM.log" 2>&1 )
  echo "exit=$?" >> "$OUT/$ARM.log"
  echo "wall=$(( $(date +%s) - START ))s" >> "$OUT/$ARM.log"
  node probe/agg.mjs "$LANE/$ARM" "$OUT/$ARM.json" "$OUT/$ARM.log" | tee -a "$OUT/summary.tsv"
  grep -h 'PROBE_JSON' "$OUT/$ARM.log" | sed "s/^.*PROBE_JSON /$LANE\t/" >> "$OUT/probe.tsv" || true
done
git checkout -- packages/cli/src/serve/managed-context-worker.test.ts
