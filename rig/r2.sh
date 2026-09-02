#!/usr/bin/env bash
# Round-2 driver (PR #10527 head 58d4658011).
#   r2.sh <arm> <test-variant> <script-mutant> <test-mutant> <latency> <pattern-key> <repeats>
# pattern-key: mint | witness | both
set -uo pipefail
arm="$1"; variant="$2"; smut="$3"; tmut="$4"; lat="$5"; pkey="$6"; repeats="${7:-1}"
SRC=/rig/src; OUT=/out; mkdir -p "$OUT"
case "$pkey" in
  mint)    pat='skips the tick on a failed config mint' ;;
  witness) pat='the failed-mint gate failure carries the observed log state' ;;
  both)    pat='(skips the tick on a failed config mint|carries the observed log state)' ;;
  *) echo "bad pattern key $pkey" >&2; exit 2 ;;
esac

for i in $(seq 1 "$repeats"); do
  work="$(mktemp -d /tmp/r2.XXXXXX)"
  cp "$SRC/autofix-status-heartbeat.sh" "$work/autofix-status-heartbeat.sh"
  cp "$SRC/$variant.test.mjs" "$work/autofix-status-heartbeat.test.mjs"

  if [ "$smut" != none ]; then
    a="$(sha256sum "$work/autofix-status-heartbeat.sh" | cut -d' ' -f1)"
    python3 /rig/mutate.py "$work/autofix-status-heartbeat.sh" "$smut" >/dev/null || {
      echo "SCRIPT MUTATION FAILED ($smut)" >&2; exit 3; }
    b="$(sha256sum "$work/autofix-status-heartbeat.sh" | cut -d' ' -f1)"
    [ "$a" != "$b" ] || { echo "SCRIPT MUTATION NO-OP ($smut)" >&2; exit 3; }
  fi
  if [ "$tmut" != none ]; then
    a="$(sha256sum "$work/autofix-status-heartbeat.test.mjs" | cut -d' ' -f1)"
    python3 /rig/mutate-test.py "$work/autofix-status-heartbeat.test.mjs" "$tmut" >/dev/null || {
      echo "TEST MUTATION FAILED ($tmut)" >&2; exit 3; }
    b="$(sha256sum "$work/autofix-status-heartbeat.test.mjs" | cut -d' ' -f1)"
    [ "$a" != "$b" ] || { echo "TEST MUTATION NO-OP ($tmut)" >&2; exit 3; }
  fi

  PATH_ORIG="$PATH"
  if [ "$lat" != "0" ]; then
    bash /rig/make-shims.sh "$work/shims" "$lat" >/dev/null
    export PATH="$work/shims:$PATH_ORIG"
  else
    export PATH="$PATH_ORIG"
  fi

  log="$OUT/${arm}.run${i}.log"
  start="${EPOCHREALTIME}"
  node --test --test-concurrency=1 --test-name-pattern="$pat" \
    "$work/autofix-status-heartbeat.test.mjs" > "$log" 2>&1
  status=$?
  end="${EPOCHREALTIME}"
  export PATH="$PATH_ORIG"
  dur="$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')"
  ran="$(grep -cE '^\s+(not )?ok [0-9]+ - ' "$log")"
  verdict=$([ $status -eq 0 ] && echo PASS || echo FAIL)
  echo "R2 arm=${arm} run=${i} variant=${variant} script=${smut} test=${tmut} lat=${lat}s pat=${pkey} ran=${ran} verdict=${verdict} wall=${dur}s"
  echo "R2 arm=${arm} run=${i} variant=${variant} script=${smut} test=${tmut} lat=${lat}s pat=${pkey} ran=${ran} verdict=${verdict} wall=${dur}s" >> "$OUT/r2-matrix.txt"
  rm -rf "$work"
done
