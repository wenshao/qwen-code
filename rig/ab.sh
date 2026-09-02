#!/usr/bin/env bash
# A/B driver for PR #10527.
#   ab.sh <arm-name> <test-variant> <script-mutant> <latency-seconds> <repeats>
# test-variant : before | after | gate1
# script-mutant: none | failopen | dieonskip
# Each run gets its own scratch dir holding ONLY the two files under test, so
# arms never share state and can run back to back.
set -uo pipefail
arm="$1"; variant="$2"; mutant="$3"; lat="$4"; repeats="${5:-1}"

SRC=/rig/src
OUT=/out
mkdir -p "$OUT"

for i in $(seq 1 "$repeats"); do
  work="$(mktemp -d /tmp/arm.XXXXXX)"
  cp "$SRC/autofix-status-heartbeat.sh" "$work/autofix-status-heartbeat.sh"
  cp "$SRC/$variant.test.mjs" "$work/autofix-status-heartbeat.test.mjs"

  if [ "$mutant" != none ]; then
    pre="$(sha256sum "$work/autofix-status-heartbeat.sh" | cut -d' ' -f1)"
    python3 /rig/mutate.py "$work/autofix-status-heartbeat.sh" "$mutant" || {
      echo "MUTATION FAILED ($mutant) — refusing to report a fake survivor" >&2; exit 3; }
    post="$(sha256sum "$work/autofix-status-heartbeat.sh" | cut -d' ' -f1)"
    [ "$pre" != "$post" ] || { echo "MUTATION NO-OP ($mutant)" >&2; exit 3; }
  fi

  export PATH_ORIG="$PATH"
  if [ "$lat" != "0" ]; then
    shimdir="$work/shims"
    bash /rig/make-shims.sh "$shimdir" "$lat" > /dev/null
    export PATH="$shimdir:$PATH_ORIG"
  else
    export PATH="$PATH_ORIG"
  fi

  log="$OUT/${arm}.run${i}.log"
  start="${EPOCHREALTIME}"
  node --test --test-concurrency=1 \
    --test-name-pattern='skips the tick on a failed config mint' \
    "$work/autofix-status-heartbeat.test.mjs" > "$log" 2>&1
  status=$?
  end="${EPOCHREALTIME}"
  dur="$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')"
  verdict=$([ $status -eq 0 ] && echo PASS || echo FAIL)
  echo "ARM=${arm} run=${i} variant=${variant} mutant=${mutant} latency=${lat}s exit=${status} verdict=${verdict} wall=${dur}s"
  echo "ARM=${arm} run=${i} variant=${variant} mutant=${mutant} latency=${lat}s exit=${status} verdict=${verdict} wall=${dur}s" >> "$OUT/matrix.txt"
  rm -rf "$work"
done
