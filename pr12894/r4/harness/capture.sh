#!/bin/bash
# Round 4 evidence captures. Uses the repo's own verify-capture.mjs; deps
# (sharp, @xterm/headless) resolve from the head worktree's node_modules.
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
CAP="node $A/head/scripts/verify-capture.mjs"
TSX=$A/head/node_modules/.bin/tsx
E=$A/evidence
cd "$A" || exit 9

# 01 - live re-run of the round-3 reported repro on both arms
{
  echo "PR 12894 round 4 - reported repro: 30000 stdout lines (~1.16 MB) + final stderr line, exit 3"
  echo "harness: real ShellExecutionService, real /bin/sh child, rawCapture budget 64 KiB, stdout sink delayed 20 ms/chunk"
  echo
  echo "### CONTROL arm  678420df (round-3 head)"
  $TSX harness/s9-stderr-preview.mts --tree ./control --only A-n30000-d20 2>&1
  echo
  echo "### HEAD arm     f415b565 (this PR head)"
  $TSX harness/s9-stderr-preview.mts --tree ./head --only A-n30000-d20 2>&1
} | $CAP --out "$E/01-ab-reported-repro-base-loses-head-keeps.png" --cols 132 --rows 46 \
     --title 'A/B: the final stderr line - control loses it, head keeps it in [Recent stderr]'

# 02 - mutation matrix, verbatim lines from the real runs
{
  echo "PR 12894 round 4 - mutation matrix (verbatim from the run logs)"
  echo
  echo "--- delta commit f415b565, suite: packages/core shellExecutionService.test.ts"
  grep -E "^=== (BASELINE|MUTANT|MA )|^ +Tests +[0-9]|^MA RESTORED|^MATRIX_DONE" results/mut4b.log
  echo
  echo "--- round-3 survivors re-measured at f415b565, each with a same-file positive control"
  grep -E "^baseline|^M17|^C-turn|^    ×" results/mut4-m17.log
  grep -E "^pre-run|^baseline|^M18|^C-store|^post-run|^    ×" results/mut4-m18.log
  echo
  echo "--- Java: round-3 kills re-measured + round-1 B2/B4 fixes reverted (H2 suites)"
  grep -E "^=== (ORIG|BASELINE|FINAL)|^--- MUTANT|Tests run: 41|BUILD (SUCCESS|FAILURE)" results/mut4-java.log
  grep -E "^M12b ORIG|^--- MUTANT|Tests run: 41|BUILD (SUCCESS|FAILURE)|^M12b RESTORED" results/mut4-java-m12b.log
} | $CAP --out "$E/02-mutation-matrix-delta-and-carried.png" --cols 132 --rows 104 \
     --title 'Mutation matrix: 4/6 delta mutants killed, ME+MF survive; M17/M18 still survive; B2R/B4R survive'

# 03 - CJK window alignment across the two arms and the candidate fix
{
  echo "PR 12894 round 4 - non-ASCII stderr: does the model get readable text?"
  echo "window alignment is set by the marker length: windowStart = 3k + markerBytes - 8192"
  echo
  echo "### CONTROL 678420df (no [Recent stderr] block at all)"
  grep -E "^(NOTE|PASS|FAIL) T[123]" results/s9c-control.log
  echo
  echo "### HEAD f415b565"
  grep -E "^(NOTE|PASS|FAIL) T[123]" results/s9c-head.log
  echo
  echo "### HEAD + candidate fix (drop leading UTF-8 continuation bytes before decode)"
  grep -E "^(NOTE|PASS|FAIL) T[123]|^RESTORED_OK|Tests +177" results/candidate-fix.log | grep -vE "NOTE T[123] (stderrBytes|blockPresent|tailCjk|tailMojibake)"
} | $CAP --out "$E/03-cjk-window-alignment-head-vs-base-vs-fix.png" --cols 132 --rows 78 \
     --title 'CJK stderr: aligned window readable, misaligned renders mojibake on both arms; 6-line fix measured'

# 04 - the preview budget band shift, stdout-only
{
  echo "PR 12894 round 4 - preview budget shift, stdout-only runs (nothing to gain from the reservation)"
  echo "completePreviewBytes 65536 -> 57344, read-order tail 32768 -> 24576"
  echo
  printf '%-10s | %-34s | %-34s\n' totalBytes "CONTROL 678420df" "HEAD f415b565"
  printf '%-10s-+-%-34s-+-%-34s\n' ---------- ---------------------------------- ----------------------------------
  for n in 56320 57344 58368 61440 64512 65536 66560 81920; do
    c=$(grep -E "^NOTE C-$n " results/s9-control.log | sed 's/NOTE C-[0-9]* //' | tr '\n' ' ' | sed 's/ = /=/g;s/  */ /g')
    h=$(grep -E "^NOTE C-$n " results/s9-head.log | sed 's/NOTE C-[0-9]* //' | tr '\n' ' ' | sed 's/ = /=/g;s/  */ /g')
    printf '%-10s | %-34s | %-34s\n' "$n" "$(echo $c | cut -c1-34)" "$(echo $h | cut -c1-34)"
  done
  echo
  echo "tail chars on a 1 MiB stdout-only run:"
  grep -E "^NOTE C-tail-shrink-1m" results/s9-control.log results/s9-head.log
} | $CAP --out "$E/04-preview-band-shift-56k-threshold.png" --cols 132 --rows 34 \
     --title 'Band shift: 56-64 KiB stdout-only runs lose their complete rendering; tail 32 KiB -> 24 KiB'

ls -la "$E"
