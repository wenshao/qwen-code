#!/bin/bash
# Captures 01 and 04, staged through files (the direct pipeline handed
# verify-capture an empty stdin).
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
CAP="node $A/head/scripts/verify-capture.mjs"
TSX=$A/head/node_modules/.bin/tsx
E=$A/evidence
R=$A/results
cd "$A" || exit 9

{
  echo "PR 12894 round 4 - reported repro: 30000 stdout lines (1.16 MB) + final stderr line, exit 3"
  echo "harness: real ShellExecutionService, real /bin/sh child, rawCapture budget 64 KiB, stdout sink delayed 20 ms/chunk"
  echo
  echo "### CONTROL arm  678420df (round-3 head)   [live re-run]"
  $TSX harness/s9-stderr-preview.mts --tree ./control --only A-n30000-d20 2>&1
  echo
  echo "### HEAD arm     f415b565 (this PR head)   [live re-run]"
  $TSX harness/s9-stderr-preview.mts --tree ./head --only A-n30000-d20 2>&1
} > "$R/cap01.txt" 2>&1
wc -l "$R/cap01.txt"
$CAP --out "$E/01-ab-reported-repro-base-loses-head-keeps.png" --cols 132 --rows 44 \
  --title 'A/B: final stderr line - control loses it, head keeps it in [Recent stderr]' < "$R/cap01.txt"

{
  echo "PR 12894 round 4 - preview budget shift, stdout-only runs (nothing gained from the reservation)"
  echo "completePreviewBytes 65536 -> 57344   read-order tail 32768 -> 24576"
  echo
  printf '%-11s| %-37s| %-37s\n' totalBytes "CONTROL 678420df" "HEAD f415b565"
  printf '%-11s+%-37s+%-37s\n' ----------- ------------------------------------- -------------------------------------
  for n in 56320 57344 58368 61440 64512 65536 66560 81920; do
    c=$(grep -E "^NOTE C-$n " "$R/s9-control.log" | sed "s/NOTE C-$n //" | tr '\n' ' ' | sed 's/ = /=/g;s/  \+/ /g' | sed 's/recentStderrBlock.*//')
    h=$(grep -E "^NOTE C-$n " "$R/s9-head.log" | sed "s/NOTE C-$n //" | tr '\n' ' ' | sed 's/ = /=/g;s/  \+/ /g' | sed 's/recentStderrBlock.*//')
    printf '%-11s| %-37s| %-37s\n' "$n" "${c:0:37}" "${h:0:37}"
  done
  echo
  echo "1 MiB stdout-only run, chars of tail the model actually sees:"
  grep -hE "^NOTE C-tail-shrink-1m (tailSectionChars|previewChars)" "$R/s9-control.log" | sed 's/^/  control 678420df  /'
  grep -hE "^NOTE C-tail-shrink-1m (tailSectionChars|previewChars)" "$R/s9-head.log" | sed 's/^/  head    f415b565  /'
} > "$R/cap04.txt" 2>&1
cat "$R/cap04.txt"
$CAP --out "$E/04-preview-band-shift-56k-threshold.png" --cols 132 --rows 30 \
  --title 'Band shift: 56-64 KiB stdout-only output loses its complete rendering' < "$R/cap04.txt"

ls -la "$E"
