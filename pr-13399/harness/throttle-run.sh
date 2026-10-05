#!/bin/bash
# Usage: throttle-run.sh <cpuquota%> <test-file> <-t pattern> <log> [KEY=VAL ...]
# Runs selected tests the way post-merge main CI does (CI=true,
# QWEN_CI_COVERAGE=1, an ecs-qwen-* RUNNER_NAME -> 60s test/hook timeouts,
# --retry=2) inside a transient systemd scope. Collection runs unthrottled;
# the CPU quota is applied the moment the first selected test's beforeEach
# creates its mkdtemp dir, and lifted when vitest prints the file result.
set -u
Q=$1; FILE=$2; PAT=$3; LOG=$(realpath -m "$4"); shift 4
WT=${WT:-/root/verify/pr13399/qwen-head}
RETRY=${RETRY:-2}
TMPD=$(mktemp -d /root/verify/pr13399/tmp/run.XXXXXX)
UNIT=pr13399-$$-$RANDOM
cd $WT/packages/cli
systemd-run --scope --unit=$UNIT --quiet env TMPDIR=$TMPD CI=true QWEN_CI_COVERAGE=1 \
  RUNNER_NAME=ecs-qwen-local NO_COLOR=1 "$@" \
  npx vitest run --retry=$RETRY --coverage.reportsDirectory=$TMPD.cov --outputFile.junit=$TMPD.cov/junit.xml "$FILE" -t "$PAT" > "$LOG" 2>&1 &
PID=$!
T0=$(date +%s.%N)
: > "$LOG.meta"
if [ "$Q" != "0" ]; then
  while kill -0 $PID 2>/dev/null; do
    if ls $TMPD 2>/dev/null | grep -q '^hosted-tool-turn-'; then
      systemctl set-property --runtime $UNIT.scope CPUQuota=${Q}% && echo "throttle ${Q}% at +$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N)-$T0}")s" >> "$LOG.meta"
      break
    fi
    sleep 0.02
  done
  while kill -0 $PID 2>/dev/null; do
    if sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -qE "^ *[✓❯×] .*$(basename $FILE) \("; then
      systemctl set-property --runtime $UNIT.scope CPUQuota= && echo "unthrottle at +$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N)-$T0}")s" >> "$LOG.meta"
      break
    fi
    sleep 0.2
  done
fi
wait $PID; RC=$?
echo "EXIT=$RC wall=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N)-$T0}")s" >> "$LOG.meta"
rm -rf $TMPD $TMPD.cov
exit $RC
