#!/usr/bin/env bash
# Colored, spec-reporter run of ONE test against ONE (variant, script-mutant, latency) cell.
#   demo.sh <test-variant> <script-mutant|none> <latency-seconds> <test-name-pattern> <label>
set -uo pipefail
variant="$1"; mutant="$2"; lat="$3"; pattern="$4"; label="$5"
work="$(mktemp -d /tmp/demo.XXXXXX)"
cp /rig/src/autofix-status-heartbeat.sh "$work/autofix-status-heartbeat.sh"
cp "/rig/src/${variant}.test.mjs" "$work/autofix-status-heartbeat.test.mjs"
if [ "$mutant" != none ]; then
  pre="$(sha256sum "$work/autofix-status-heartbeat.sh" | cut -d' ' -f1)"
  python3 /rig/mutate.py "$work/autofix-status-heartbeat.sh" "$mutant" >/dev/null || { echo "MUTATION FAILED ($mutant)" >&2; exit 3; }
  post="$(sha256sum "$work/autofix-status-heartbeat.sh" | cut -d' ' -f1)"
  [ "$pre" != "$post" ] || { echo "MUTATION NO-OP ($mutant)" >&2; exit 3; }
fi
if [ "$lat" != "0" ]; then bash /rig/make-shims.sh "$work/shims" "$lat" >/dev/null; export PATH="$work/shims:$PATH"; fi
printf '\033[1;36m$ %s\033[0m\n' "$label"
printf '\033[2m  test=%s.test.mjs  script=%s  fork-latency=%ss  node=%s\033[0m\n' "$variant" "$mutant" "$lat" "$(node -v)"
start="${EPOCHREALTIME}"
node --test --test-reporter=spec --test-concurrency=1 \
  --test-name-pattern="$pattern" \
  "$work/autofix-status-heartbeat.test.mjs" 2>&1 | sed -e "s#$work/##g"
status=${PIPESTATUS[0]}
end="${EPOCHREALTIME}"
printf '\033[2m  exit=%s wall=%ss\033[0m\n' "$status" "$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')"
rm -rf "$work"
exit "$status"
