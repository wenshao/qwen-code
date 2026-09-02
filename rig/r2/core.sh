#!/usr/bin/env bash
# Core matrix for the round-2 verification of PR #10527 (head 58d4658011).
set -uo pipefail
OUT=/out; mkdir -p "$OUT"; : > "$OUT/matrix.txt"
echo "node=$(node -v) bash=$(bash --version | head -1) $(cat /etc/os-release | grep PRETTY | cut -d= -f2)" | tee "$OUT/env.txt"

echo "=== E1: A/B, single test, 0.3 s/fork x5 ===" | tee -a "$OUT/progress.txt"
bash /rig/ab.sh before-0.3 before none 0.3 5
bash /rig/ab.sh after-0.3  after  none 0.3 5
echo "=== E2: baseline 0 s/fork x3 ===" | tee -a "$OUT/progress.txt"
bash /rig/ab.sh before-0 before none 0 3
bash /rig/ab.sh after-0  after  none 0 3

echo "=== E3: production-script mutants vs the post-fix gate, 0.3 s/fork x3 ===" | tee -a "$OUT/progress.txt"
for m in failopen dieonskip bareassign mintok; do bash /rig/ab.sh "after-$m-0.3" after "$m" 0.3 3; done
bash /rig/ab.sh gate1-failopen-0.3 gate1 failopen 0.3 3
bash /rig/ab.sh before-failopen-0.3 before failopen 0.3 3
bash /rig/ab.sh before-dieonskip-0.3 before dieonskip 0.3 3

echo "=== E4: failure-message shapes on the REAL loop (spec reporter) ===" | tee -a "$OUT/progress.txt"
P='skips the tick on a failed config mint'
bash /rig/demo.sh before none      0.3 "$P" "before (main): fixed 2.5 s sleep, 0.3 s/fork  — the CI red"          > "$OUT/demo-before-red.ans" 2>&1
bash /rig/demo.sh after  none      0.3 "$P" "after (PR head): second-occurrence gate, 0.3 s/fork"                > "$OUT/demo-after-green.ans" 2>&1
bash /rig/demo.sh after  dieonskip 0   "$P" "after vs pulse-death mutant (continue -> exit 0)"                    > "$OUT/demo-after-dieonskip.ans" 2>&1
bash /rig/demo.sh after  mintok    0   "$P" "after vs never-skips mutant (mint ignores RUNNER_TEMP)"              > "$OUT/demo-after-mintok.ans" 2>&1
bash /rig/demo.sh after  failopen  0.3 "$P" "after vs fail-open mutant (skip logged, continue dropped), 0.3 s/fork" > "$OUT/demo-after-failopen.ans" 2>&1
bash /rig/demo.sh before dieonskip 0   "$P" "before vs pulse-death mutant (for contrast)"                          > "$OUT/demo-before-dieonskip.ans" 2>&1
bash /rig/demo.sh before mintok    0   "$P" "before vs never-skips mutant (for contrast)"                          > "$OUT/demo-before-mintok.ans" 2>&1

echo "=== E5: test-side variants (witness adequacy) ===" | tee -a "$OUT/progress.txt"
W='failed config mint|failed-mint gate'
bash /rig/demo.sh after     none 0 "$W" "after: the failed-mint test + its new witness"                          > "$OUT/var-after.ans" 2>&1;     echo "VARIANT after exit=$?"     | tee -a "$OUT/variants.txt"
bash /rig/demo.sh baremsg   none 0 "$W" "variant baremsg: gate message reverted to the bare sentence"           > "$OUT/var-baremsg.ans" 2>&1;   echo "VARIANT baremsg exit=$?"   | tee -a "$OUT/variants.txt"
bash /rig/demo.sh noqq      none 0 "$W" "variant noqq: '?? []' dropped from the post-timeout count (R13 probe)" > "$OUT/var-noqq.ans" 2>&1;      echo "VARIANT noqq exit=$?"      | tee -a "$OUT/variants.txt"
bash /rig/demo.sh noqqpred  none 0 "$W" "variant noqqpred: '?? []' dropped from the polling predicate"          > "$OUT/var-noqqpred.ans" 2>&1;  echo "VARIANT noqqpred exit=$?"  | tee -a "$OUT/variants.txt"
bash /rig/demo.sh absentlog none 0 "$W" "variant absentlog: witness plants NO heartbeat.log (D14-1)"            > "$OUT/var-absentlog.ans" 2>&1; echo "VARIANT absentlog exit=$?" | tee -a "$OUT/variants.txt"
bash /rig/demo.sh emptylog  none 0 "$W" "variant emptylog: witness plants an EMPTY heartbeat.log (D14-1)"      > "$OUT/var-emptylog.ans" 2>&1;  echo "VARIANT emptylog exit=$?"  | tee -a "$OUT/variants.txt"
# the full file under each test-side variant: does the suite as a whole catch it?
for v in baremsg noqq noqqpred; do
  work="$(mktemp -d /tmp/full.XXXXXX)"; cp /rig/src/autofix-status-heartbeat.sh "$work/"; cp "/rig/src/$v.test.mjs" "$work/autofix-status-heartbeat.test.mjs"
  node --test --test-concurrency=1 "$work/autofix-status-heartbeat.test.mjs" > "$OUT/full-$v.tap" 2>&1; st=$?
  echo "FULLFILE variant=$v exit=$st $(grep -E '^# (tests|pass|fail)' "$OUT/full-$v.tap" | tr '\n' ' ')" | tee -a "$OUT/variants.txt"; rm -rf "$work"
done
echo "=== E5b: witness determinism x20 ===" | tee -a "$OUT/progress.txt"
work="$(mktemp -d /tmp/wit.XXXXXX)"; cp /rig/src/autofix-status-heartbeat.sh "$work/"; cp /rig/src/after.test.mjs "$work/autofix-status-heartbeat.test.mjs"
pass=0; for i in $(seq 1 20); do node --test --test-concurrency=1 --test-name-pattern='carries the observed log state' "$work/autofix-status-heartbeat.test.mjs" >/dev/null 2>&1 && pass=$((pass+1)); done
echo "WITNESS x20 pass=$pass" | tee -a "$OUT/variants.txt"; rm -rf "$work"
echo "=== core done ===" | tee -a "$OUT/progress.txt"
