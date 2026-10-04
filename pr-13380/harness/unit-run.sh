#!/bin/bash
# usage: unit-run.sh <cpuquota%|none> <arm: armbase|armpr|armsettle> <log> <testname-pattern> [retry]
set -u
Q=$1; ARM=$2; LOG=$(realpath -m "$3"); PAT=$4; RETRY=${5:-0}
WT=/root/verify/pr13380/head
TMPD=$(mktemp -d /root/verify/pr13380/unit/tmp/run.XXXXXX)
UNIT=pr13380-$$-$RANDOM
cd $WT/packages/cli
systemd-run --scope --unit=$UNIT --quiet taskset -c 12-15 env TMPDIR=$TMPD CI=true QWEN_CI_COVERAGE=1 \
  RUNNER_NAME=ecs-qwen-local NO_COLOR=1 \
  npx vitest run --retry=$RETRY --coverage.reportsDirectory=$TMPD.cov --coverage.all=false --coverage.include=src/serve/hosted-workspace-tool-turn.ts --outputFile.junit=$TMPD.cov/junit.xml \
  src/serve/hosted-workspace-tool-turn.$ARM.test.ts -t "$PAT" > "$LOG" 2>&1 &
PID=$!
T0=$(date +%s.%N)
if [ "$Q" != "none" ]; then
while kill -0 $PID 2>/dev/null; do
  if ls $TMPD 2>/dev/null | grep -q '^hosted-tool-turn-'; then
    systemctl set-property --runtime $UNIT.scope CPUQuota=${Q}% && echo "throttle ${Q}% at +$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N)-$T0}")s" >> "$LOG.meta"
    break
  fi
  sleep 0.02
done
while kill -0 $PID 2>/dev/null; do
  if sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -qE "^ *[✓❯×] .*hosted-workspace-tool-turn.$ARM.test.ts \("; then
    systemctl set-property --runtime $UNIT.scope CPUQuota= && echo "unthrottle at +$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N)-$T0}")s" >> "$LOG.meta"
    break
  fi
  sleep 0.2
done
fi
wait $PID; RC=$?
echo "EXIT=$RC" >> "$LOG.meta"
rm -rf $TMPD $TMPD.cov
exit $RC
