#!/bin/bash
# Usage: throttle-run.sh <cpuquota%> <test-file> <log> [extra env KEY=VAL ...]
# Runs the "settled file tool outcome" test the way main CI does (CI=true,
# QWEN_CI_COVERAGE=1, an ecs-qwen-* RUNNER_NAME -> 60s test/hook timeouts,
# --retry=2) inside a transient systemd scope. Collection runs unthrottled;
# the CPU quota is applied the moment the first selected test's beforeEach
# creates its mkdtemp dir, and lifted when vitest prints the file result.
set -u
Q=$1; FILE=$2; LOG=$(realpath -m "$3"); shift 3
WT=${WT:-/root/verify/pr13411/qwen-head}
TMPD=$(mktemp -d /root/verify/pr13411/tmp/run.XXXXXX)
UNIT=pr13411-$$-$RANDOM
cd $WT/packages/cli
systemd-run --scope --unit=$UNIT --quiet env TMPDIR=$TMPD CI=true QWEN_CI_COVERAGE=1 \
  RUNNER_NAME=ecs-qwen-local FORCE_COLOR=1 "$@" \
  npx vitest run --retry=2 --coverage.reportsDirectory=$TMPD.cov --outputFile.junit=$TMPD.cov/junit.xml "$FILE" -t "${FILTER:-settled file tool outcome is missing}" > "$LOG" 2>&1 &
PID=$!
T0=$(date +%s.%N)
while kill -0 $PID 2>/dev/null; do
  if ls $TMPD 2>/dev/null | grep -q '^hosted-harness-test-'; then
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
wait $PID; RC=$?
echo "EXIT=$RC" >> "$LOG.meta"
rm -rf $TMPD $TMPD.cov
exit $RC
