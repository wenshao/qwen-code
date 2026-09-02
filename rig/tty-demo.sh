#!/usr/bin/env bash
# Colored, TTY-attached demonstration run of ONE arm (spec reporter).
set -uo pipefail
variant="$1"; lat="$2"; label="$3"
work="$(mktemp -d /tmp/tty.XXXXXX)"
cp /rig/src/autofix-status-heartbeat.sh "$work/autofix-status-heartbeat.sh"
cp "/rig/src/${variant}.test.mjs" "$work/autofix-status-heartbeat.test.mjs"
if [ "$lat" != "0" ]; then bash /rig/make-shims.sh "$work/shims" "$lat" >/dev/null; export PATH="$work/shims:$PATH"; fi
printf '\033[1;36m$ %s\033[0m\n' "$label"
node --test --test-reporter=spec --test-concurrency=1 \
  --test-name-pattern='skips the tick on a failed config mint' \
  "$work/autofix-status-heartbeat.test.mjs" 2>&1 | sed -e "s#$work/##g"
rm -rf "$work"
