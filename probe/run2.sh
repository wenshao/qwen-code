#!/bin/bash
# probe/run2.sh <lane: inherit|cmd> <repeats> <arms...>: the PR's deferred items.
#   cp-repeat  head-repeat with the Shell tool forced onto child_process (item 2)
#   cp-probe   probe arm on child_process (timer lifetime, leftovers)
#   d1-none / d1-M2   "cancels an in-flight call of an installed Session" (item 1)
#   d2-none / d2-M2   "cancels an in-flight shell execution" (item 1)
set -u
LANE=$1; REPEATS=$2; shift 2
OUT=probe-out2/$LANE
mkdir -p "$OUT"
lane_env() {
  case $LANE in
    inherit) env "$@" ;;
    cmd) env PROBE_UNSET_GITBASH=1 "$@" ;;
  esac
}
force_child_process() {
  node -e "
    const fs = require('node:fs');
    const f = 'packages/core/src/utils/shell-utils.ts';
    const from = 'export function shouldDefaultToNodePty(): boolean {\n';
    const s = fs.readFileSync(f, 'utf8');
    if (s.split(from).length !== 2) { console.error('TRANSFORM_FAILED child_process'); process.exit(1); }
    fs.writeFileSync(f, s.replace(from, from + '  return false;\n'));
    console.log('FORCED child_process');"
}
unset_gitbash_in() {
  # Same in-process lane switch as transform.mjs, for a file it does not write.
  node -e "
    const fs = require('node:fs');
    const f = process.argv[1];
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('\ndescribe(');
    if (i < 0) { console.error('TRANSFORM_FAILED lane ' + f); process.exit(1); }
    fs.writeFileSync(f, s.slice(0, i) + \"\nif (process.env['PROBE_UNSET_GITBASH'] === '1') {\n  delete process.env['MSYSTEM'];\n  delete process.env['TERM'];\n}\n\" + s.slice(i));" "$1"
}
leftovers() {
  if [ -n "${WINDIR:-}" ]; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File probe/procs.ps1 | tr -d '\r'
  else
    ps -axo pid=,command=
  fi | grep -E 'setTimeout\(String, 30000\)|\|sleep\.exe\||^ *[0-9]+ +sleep 30$' || true
}
for ARM in "$@"; do
  git checkout -- packages/cli/src/serve/ packages/core/src/utils/shell-utils.ts
  FILE=src/serve/managed-context-worker.test.ts
  case $ARM in
    cp-repeat) node probe/transform.mjs head-repeat "$REPEATS" && force_child_process || continue
      FILTER=(-t 'refuses release while an invocation is active|retains status and cancel for an active invocation') ;;
    cp-probe) node probe/transform.mjs probe "$REPEATS" && force_child_process || continue
      FILTER=(-t 'PROBE' --silent=false) ;;
    d1-none|d1-M2) node probe/transform.mjs "head-${ARM#d1-}" 1 2>/dev/null || node probe/transform.mjs head-full 1 || continue
      FILTER=(-t 'cancels an in-flight call of an installed Session') ;;
    d2-none|d2-M2) FILE=src/serve/managed-runtime-tool-worker.test.ts
      [ "$ARM" = d2-M2 ] && { node probe/transform.mjs head-M2 1 || continue; git checkout -- packages/cli/src/serve/managed-context-worker.test.ts; }
      unset_gitbash_in "packages/cli/$FILE" || continue
      FILTER=(-t 'cancels an in-flight shell execution') ;;
    *) echo "unknown arm $ARM"; continue ;;
  esac
  START=$(date +%s)
  ( cd packages/cli && lane_env npx vitest run "$FILE" "${FILTER[@]}" \
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
git checkout -- packages/cli/src/serve/ packages/core/src/utils/shell-utils.ts
