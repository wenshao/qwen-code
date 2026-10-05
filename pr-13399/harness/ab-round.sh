#!/bin/bash
# One A/B round on the CI-failing test, unmodified files, main-CI config with
# --retry=2: armorig (1s, pre-#13380) vs armmain (5s, main) vs head (10s, PR)
# at each CPU quota, all in parallel so shared host noise hits every arm alike.
# Usage: ab-round.sh <round> <quota...>
R=$1; shift; OUT=/root/verify/pr13399/runs/ab; mkdir -p $OUT
H=/root/verify/pr13399/harness/throttle-run.sh
PAT='reports an answer that loses the race to the expiry as expired'
for q in "$@"; do
  $H $q src/serve/hosted-workspace-tool-turn.armorig.test.ts "$PAT" $OUT/orig-q$q-r$R.log &
  $H $q src/serve/hosted-workspace-tool-turn.armmain.test.ts "$PAT" $OUT/main-q$q-r$R.log &
  $H $q src/serve/hosted-workspace-tool-turn.test.ts "$PAT" $OUT/head-q$q-r$R.log &
done
wait
