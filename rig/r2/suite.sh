#!/usr/bin/env bash
# Runs the 23-file HELPER_TESTS list exactly as ci.yml does, from the exported PR tree.
set -uo pipefail
cd /tree
HELPER_TESTS="$(grep -oE "HELPER_TESTS: '[^']+'" .github/workflows/ci.yml | head -1 | sed -E "s/HELPER_TESTS: '(.*)'/\1/")"
echo "files: $(echo $HELPER_TESTS | wc -w)"
git config --global user.email ci@example.test >/dev/null 2>&1 || true
git config --global user.name ci >/dev/null 2>&1 || true
start="${EPOCHREALTIME}"
node --test --test-concurrency=1 $HELPER_TESTS > /out/suite.tap 2>&1
status=$?
end="${EPOCHREALTIME}"
echo "exit=$status wall=$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.1f", b-a}')s"
grep -E "^# (tests|pass|fail|cancelled|skipped|duration_ms)" /out/suite.tap
grep -E "^\s*not ok" /out/suite.tap | head -40
