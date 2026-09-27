#!/bin/bash
# Round-3 figure: round-2 fixes re-checked on r3 after the main merge.
export R=${SCRATCH:-/tmp/pr11959}/r3-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(models=0|= 200\\.0k)/\033[31;1m\\1\033[0m/g; s/(models=194)/\033[32m\\1\033[0m/g; s/^(r3 +project[^ ]* +)(requests-to-planted-host=0)/\\1\033[32;1m\\2\033[0m/; s/(global-cache=planted)/\033[33m\\1\033[0m/'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 3 (r3 = 1bb0e56e, main merged): round-2 fixes re-checked through the real CLI"
echo
printf '\033[1m%s\033[0m\n' "1) 'Context window' from /context -d (base3 = merge-base 700620f4)"
ARMS="base3 r3 r3-off" MODELS="claude-fable-5 qwen-flash claude-sonnet-4-5 deepseek-v3 deepseek-v3-0324" $RIG/ctx-matrix.sh 2>/dev/null
echo
printf '\033[1m%s\033[0m\n' "2) F1: lifecycle steps 5-6 on r3 (/foreign = 200 with a gateway error body)"
CLI=$R3 SUFFIX=-r3 $RIG/refresh-lifecycle.sh 2>/dev/null | sed -n '/== 5/,$p' | grep -v "^  last:" | color
echo
printf '\033[1m%s\033[0m\n' "3) Heal guard: cache poisoned by r1, same URL recovers"
HEAL_ARM=r3 $RIG/heal.sh 2>/dev/null | grep -v "mirror requests" | sed -E 's/ fetchedAt=[^ ]*//' | color
echo
printf '\033[1m%s\033[0m\n' "4) F2: channels that can set QWEN_CODE_MODELS_DEV_URL (fresh QWEN_HOME per row)"
CHANNEL_ARMS=r3 $RIG/projenv-channels.sh 2>/dev/null | grep . | color
echo; echo "[figure complete]"
