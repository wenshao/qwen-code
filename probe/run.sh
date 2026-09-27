#!/bin/bash
# probe/run.sh <lane: inherit|cmd|pwsh> <repeats> <arms...>; run from the repo root.
set -u
LANE=$1; REPEATS=$2; shift 2
OUT=probe-out${PROBE_TAG:+-$PROBE_TAG}/$LANE
mkdir -p "$OUT"
lane_env() {
  case $LANE in
    inherit) env "$@" ;;
    cmd) env PROBE_UNSET_GITBASH=1 "$@" ;;
    pwsh) env PROBE_UNSET_GITBASH=1 PROBE_COMSPEC="${PWSH_PATH:?}" "$@" ;;
  esac
}
leftovers() {
  if [ -n "${WINDIR:-}" ]; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File probe/procs.ps1 | tr -d '\r'
  else
    ps -axo pid=,command=
  fi | grep -E 'setTimeout\(String, 30000\)|\|sleep\.exe\||^ *[0-9]+ +sleep 30$' || true
}
for ARM in "$@"; do
  git checkout -- packages/cli/src/serve/
  node probe/transform.mjs "$ARM" "$REPEATS" || continue
  case $ARM in
    *-full) FILTER=() ;;
    probe|quoting) FILTER=(-t 'PROBE' --silent=false) ;;
    *) FILTER=(-t 'refuses release while an invocation is active|retains status and cancel for an active invocation') ;;
  esac
  START=$(date +%s)
  ( cd packages/cli && lane_env npx vitest run src/serve/managed-context-worker.test.ts "${FILTER[@]}" \
      --reporter=default --reporter=json --outputFile.json="../../$OUT/$ARM.json" > "../../$OUT/$ARM.log" 2>&1 )
  echo "exit=$?" >> "$OUT/$ARM.log"
  echo "wall=$(( $(date +%s) - START ))s" >> "$OUT/$ARM.log"
  sleep 2
  LEFT=$(leftovers)
  echo "leftovers=$(printf '%s' "$LEFT" | grep -c . || true)" >> "$OUT/$ARM.log"
  [ -n "$LEFT" ] && printf '%s\n' "$LEFT" | sed 's/^/LEFTOVER /' >> "$OUT/$ARM.log"
  node probe/agg.mjs "$LANE/$ARM" "$OUT/$ARM.json" "$OUT/$ARM.log" | tee -a "$OUT/summary.tsv"
  grep -h 'PROBE_JSON' "$OUT/$ARM.log" | sed "s/^.*PROBE_JSON /$LANE	/" >> "$OUT/probe.tsv" || true
done
git checkout -- packages/cli/src/serve/
