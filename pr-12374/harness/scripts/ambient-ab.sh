#!/bin/bash
# A/B: run the housekeeping suites with an ambient QWEN_RUNTIME_DIR pointing at a
# sentinel "real" debug dir. Arm r2 = test files from b83983c19, arm r3 = PR head tests.
# Production source is the PR head in both arms; only the two test files differ.
set -u
WT=/root/git/h12374; OUT=/root/git/h12374-e2e/out; U=/root/git/h12374-e2e/u1500
T1=packages/cli/src/services/housekeeping/scheduler.test.ts
T2=packages/cli/src/utils/housekeeping/cleanup.test.ts
cp $WT/$T1 $OUT/.r3-scheduler.test.ts; cp $WT/$T2 $OUT/.r3-cleanup.test.ts
seed() {
  S=$U/sentinel-runtime; rm -rf $S; mkdir -p $S/debug
  for id in aaaaaaaa-0000-4000-8000-00000000000{1,2,3}; do echo "real log" > $S/debug/$id.txt; touch -d '60 days ago' $S/debug/$id.txt; done
  echo x > $S/debug/transcript-replay.txt; touch -d '60 days ago' $S/debug/transcript-replay.txt
  echo x > $S/debug/bbbbbbbb-0000-4000-8000-000000000001.txt
  chown -R 1500:1500 $S
}
run() { # $1=label
  seed
  before=$(ls $U/sentinel-runtime/debug | sort | tr '\n' ' ')
  (cd $WT/packages/cli && timeout 600 setpriv --reuid=1500 --regid=1500 --clear-groups env HOME=$U TMPDIR=$U QWEN_RUNTIME_DIR=$U/sentinel-runtime \
     npx vitest run src/utils/housekeeping/cleanup.test.ts src/services/housekeeping/scheduler.test.ts --reporter=default --coverage.enabled=false 2>&1) > $OUT/ambient-$1.log
  after=$(ls $U/sentinel-runtime/debug | sort | tr '\n' ' ')
  markers=$(ls -a $U/sentinel-runtime 2>/dev/null | grep -c '^\.debug-logs-cleanup' || true)
  echo "== $1"; grep -E "Tests +[0-9]" $OUT/ambient-$1.log
  echo "sentinel before: $before"; echo "sentinel after:  $after"
}
git -C $WT show b83983c19:$T1 > $WT/$T1; git -C $WT show b83983c19:$T2 > $WT/$T2
run r2-tests
cp $OUT/.r3-scheduler.test.ts $WT/$T1; cp $OUT/.r3-cleanup.test.ts $WT/$T2
run r3-tests
git -C $WT status --short | head
