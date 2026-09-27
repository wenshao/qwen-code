#!/bin/bash
# Round-4 figure: what 4d9bbdef changes in loadModelCatalog(), through the real CLI.
export R=${SCRATCH:-/tmp/pr11959}/r4-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(models=0|= 200\\.0k)/\033[31;1m\\1\033[0m/g; s/(models=194)/\033[32m\\1\033[0m/g'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 4: r3 = 1bb0e56e (round 3) vs r4 = 4d9bbdef (autofix round 8), real dist/cli.js, fresh QWEN_HOME per cell"
echo
printf '\033[1m%s\033[0m\n' "1) A cache already on disk with a far-future fetchedAt (QWEN_CODE_MODELS_DEV_REFRESH=off)"
$RIG/plant.sh 2>/dev/null | awk 'NR==1{printf "\033[1m%s\033[0m\n", $0; next} {printf "%s\033[31m%-20s\033[0m -> \033[32m%s\033[0m\n", substr($0,1,45), substr($0,46,20), substr($0,66)}'
echo
printf '\033[1m%s\033[0m\n' "2) Cache poisoned by r1 (models: {}), then the same URL recovers: the first r4 session no longer starts at 200K"
HEAL_ARM=r4 $RIG/heal.sh 2>/dev/null | grep -v "mirror requests" | sed -E 's/ fetchedAt=[^ ]*//' | color
echo
printf '\033[1m%s\033[0m\n' "3) Bundled snapshot, /context -d (base3 = merge-base 700620f4)"
ARMS="base3 r3 r4" MODELS="qwen3-coder-plus MiniMax-M2.5 glm-4.7 claude-fable-5" $RIG/ctx-matrix.sh 2>/dev/null
printf '\033[2m%s\033[0m\n' "qwen3-coder-plus is back at the vendor-declared 1,000,000; MiniMax-M2.5 / glm-4.7 still differ from the provider presets (196,608 / 202,752)"
echo; echo "[figure complete]"
