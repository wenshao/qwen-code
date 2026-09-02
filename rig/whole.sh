#!/usr/bin/env bash
# Whole-file arm: runs the ENTIRE autofix-status-heartbeat.test.mjs the way CI
# does. The 22 loop tests inside the describe run CONCURRENTLY (node:test
# suite semantics), each spawning its own detached bash loop — this is the
# contention the loaded self-hosted runner actually had.
#   whole.sh <arm> <variant> <hogs> <repeats>
set -uo pipefail
arm="$1"; variant="$2"; hogs="$3"; repeats="${4:-1}"; lat="${5:-0}"
SRC=/rig/src; OUT=/out; mkdir -p "$OUT"
target='skips the tick on a failed config mint'

for i in $(seq 1 "$repeats"); do
  work="$(mktemp -d /tmp/whole.XXXXXX)"
  cp "$SRC/autofix-status-heartbeat.sh" "$work/autofix-status-heartbeat.sh"
  cp "$SRC/$variant.test.mjs" "$work/autofix-status-heartbeat.test.mjs"

  pids=()
  for ((h=0; h<hogs; h++)); do
    ( while :; do :; done ) & pids+=($!)
  done

  PATH_ORIG="$PATH"
  if [ "$lat" != "0" ]; then
    bash /rig/make-shims.sh "$work/shims" "$lat" > /dev/null
    export PATH="$work/shims:$PATH_ORIG"
  else
    export PATH="$PATH_ORIG"
  fi

  log="$OUT/${arm}.run${i}.log"
  start="${EPOCHREALTIME}"
  node --test --test-concurrency=1 "$work/autofix-status-heartbeat.test.mjs" > "$log" 2>&1
  status=$?
  end="${EPOCHREALTIME}"
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done

  dur="$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')"
  if grep -qF "not ok" "$log" && grep -F "$target" "$log" | grep -q "not ok"; then
    tgt=FAIL
  elif grep -F "$target" "$log" | grep -q "^\s*ok\|ok [0-9]"; then
    tgt=PASS
  else
    tgt=UNKNOWN
  fi
  fails="$(grep -cE '^\s+not ok [0-9]+ - ' "$log")"
  echo "WHOLE arm=${arm} run=${i} variant=${variant} hogs=${hogs} lat=${lat} exit=${status} target=${tgt} subtest_failures=${fails} wall=${dur}s"
  echo "WHOLE arm=${arm} run=${i} variant=${variant} hogs=${hogs} lat=${lat} exit=${status} target=${tgt} subtest_failures=${fails} wall=${dur}s" >> "$OUT/whole-matrix.txt"
  rm -rf "$work"
done
