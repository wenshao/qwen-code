#!/bin/bash
# Run one arm of the monitor E2E against the real model through the
# recording proxy.
#   run-arm.sh <arm: base|pr> <inject_ms> <run_id> [vitest -t filter]
# base = origin/main's cli/monitor.test.ts (copied verbatim to cli/basemon.test.ts)
# pr   = the PR's cli/monitor.test.ts
# Both run against the same dist/cli.js (main + PR merged; the PR changes
# only the test file).
set -u
ARM=$1; INJECT=$2; RID=$3; FILTER=${4:-}
ROOT=${ROOT:-/root/verify/pr13005}
WT=$ROOT/wt
OUT=$ROOT/runs/$RID
mkdir -p "$OUT/home"
echo '{}' > "$OUT/home/settings.json"
case $ARM in
  base) FILE=cli/basemon.test.ts ;;
  pr) FILE=cli/monitor.test.ts ;;
  hard) FILE=cli/monhard.test.ts ;;
  *) echo "bad arm"; exit 2 ;;
esac

UPSTREAM=${UPSTREAM:?set UPSTREAM to an OpenAI-compatible base URL} \
UPSTREAM_KEY=${UPSTREAM_KEY:?set UPSTREAM_KEY} \
LOG=$OUT/proxy.jsonl INJECT_MS=$INJECT PORT=0 \
  node $ROOT/harness/record-proxy.mjs > "$OUT/proxy.out" 2>&1 &
PROXY_PID=$!
for _ in $(seq 50); do grep -qs PROXY_READY "$OUT/proxy.out" && break; sleep 0.1; done
BASE_URL=$(grep -o 'http://[^ ]*' "$OUT/proxy.out")

cd "$WT/integration-tests"
T0=$(date +%s.%N)
ARGS=(run "$FILE" --retry=0)
[ -n "$FILTER" ] && ARGS+=(-t "$FILTER")
EXTRA=(); if [ -n "${MUT_SHIM:-}" ]; then EXTRA=(PATH="$MUT_SHIM:$PATH" INTEGRATION_TEST_USE_INSTALLED_GEMINI=true); fi
env -u NO_COLOR "${EXTRA[@]}" CI=true FORCE_COLOR=1 KEEP_OUTPUT=true VERBOSE=true QWEN_SANDBOX=false \
  QWEN_HOME="$OUT/home" OPENAI_API_KEY=dummy-key-proxy-injects OPENAI_BASE_URL="$BASE_URL" \
  OPENAI_MODEL=qwen3.8-max \
  npx vitest "${ARGS[@]}" > "$OUT/vitest.ansi" 2>&1
RC=$?
T1=$(date +%s.%N)
kill $PROXY_PID 2>/dev/null
RUNDIR=$(sed 's/\x1b\[[0-9;]*m//g' "$OUT/vitest.ansi" | grep -o 'Integration test output directory: .*' | head -1 | sed 's/.*: //')
[ -n "$RUNDIR" ] && [ -d "$RUNDIR" ] && cp -r "$RUNDIR" "$OUT/itest-output"
printf '{"arm":"%s","injectMs":%s,"rid":"%s","filter":"%s","exit":%s,"wallSec":%s}\n' \
  "$ARM" "$INJECT" "$RID" "$FILTER" "$RC" "$(awk "BEGIN{printf \"%.1f\", $T1 - $T0}")" > "$OUT/meta.json"
echo "DONE $RID exit=$RC"
