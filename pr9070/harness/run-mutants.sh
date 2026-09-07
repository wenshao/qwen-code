#!/bin/zsh
set -e
WT=$1
RIG=$2
OUT=$3
mkdir -p $OUT
MUTANTS=(M1-teammate-abort M2-teammate-nonstreamjson M3-teammate-nonsuccess M4-teammate-catch M5-headless-reason M6-drop-conjunct M7-auq-true M8-base-false M9-message-text)
for m in $MUTANTS; do
  python3 $RIG/mutate.py $WT $m apply || { echo "$m MISS" >> $OUT/summary.txt; continue; }
  RES=""
  (cd $WT/packages/core && npx vitest run --coverage.enabled=false src/tools/askUserQuestion.test.ts > $OUT/$m.core-auq.log 2>&1) && RES="$RES core-auq:PASS" || RES="$RES core-auq:FAIL"
  (cd $WT/packages/core && npx vitest run --coverage.enabled=false src/core/coreToolScheduler.test.ts -t "plan mode with ask_user_question" > $OUT/$m.core-sched.log 2>&1) && RES="$RES core-sched:PASS" || RES="$RES core-sched:FAIL"
  (cd $WT/packages/cli && npx vitest run --coverage.enabled=false src/nonInteractive/control/controllers/permissionController.test.ts > $OUT/$m.cli-pc.log 2>&1) && RES="$RES cli-pc:PASS" || RES="$RES cli-pc:FAIL"
  (cd $WT/packages/cli && npx vitest run --coverage.enabled=false src/nonInteractiveCli.test.ts > $OUT/$m.cli-nic.log 2>&1) && RES="$RES cli-nic:PASS" || RES="$RES cli-nic:FAIL"
  echo "$m $RES" | tee -a $OUT/summary.txt
  python3 $RIG/mutate.py $WT $m restore
done
